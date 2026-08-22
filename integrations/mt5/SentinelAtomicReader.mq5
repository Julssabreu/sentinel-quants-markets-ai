#property strict
#property version   "1.30"
#property description "Sentinel central read-only bridge for Atomic Analyst MT5"

input string InpIndicatorName  = "Atomic Analyst MT5";
input int    InpBuyBuffer      = 11;
input int    InpSellBuffer     = 12;
input bool   InpClosedBarOnly  = true;
input int    InpRefreshSeconds = 2;

string status_file  = "Sentinel\\AtomicMT5_Status.txt";
string signals_file = "Sentinel\\AtomicMT5_Signals.txt";
string test_request_file = "Sentinel\\AtomicMT5_TestRequest.txt";
string processed_ids[];
string last_test_token="";

bool IsSignalValue(const double value)
{
   return MathIsValidNumber(value) && value != EMPTY_VALUE && value != 0.0;
}

bool IsAtomicIndicator(const string name)
{
   string candidate=name;
   string configured=InpIndicatorName;
   StringToLower(candidate);
   StringToLower(configured);
   return StringFind(candidate,configured)>=0 || StringFind(candidate,"atomic analyst")>=0;
}

string TimeframeName(const ENUM_TIMEFRAMES timeframe)
{
   string value = EnumToString(timeframe);
   StringReplace(value,"PERIOD_","");
   return value;
}

bool WasProcessed(const string id)
{
   int total=ArraySize(processed_ids);
   for(int i=0;i<total;i++) if(processed_ids[i]==id) return true;
   ArrayResize(processed_ids,total+1);
   processed_ids[total]=id;
   if(ArraySize(processed_ids)>2000)
   {
      for(int i=1;i<ArraySize(processed_ids);i++) processed_ids[i-1]=processed_ids[i];
      ArrayResize(processed_ids,2000);
   }
   return false;
}

void AppendSignal(const string signal_type,const string symbol,const ENUM_TIMEFRAMES timeframe,
                  const datetime bar_time,const double value,const int digits)
{
   string tf=TimeframeName(timeframe);
   string id=symbol+"-"+tf+"-"+IntegerToString((long)bar_time)+"-"+signal_type;
   if(WasProcessed(id)) return;
   int file=FileOpen(signals_file,FILE_COMMON|FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(file==INVALID_HANDLE) return;
   FileSeek(file,0,SEEK_END);
   string line="ID="+id+" | Type="+signal_type+" | Symbol="+symbol+" | TF="+tf+
               " | Time="+TimeToString(bar_time,TIME_DATE|TIME_SECONDS)+" | Value="+DoubleToString(value,digits)+
               " | BuyBuffer="+IntegerToString(InpBuyBuffer)+" | SellBuffer="+IntegerToString(InpSellBuffer)+
               " | Source=Atomic Analyst MT5";
   FileWriteString(file,line+"\r\n");
   FileClose(file);
   Print("Sentinel: captured ",signal_type," from ",symbol," ",tf," at ",TimeToString(bar_time));
}

void ProcessTestRequest(const int sources)
{
   int request=FileOpen(test_request_file,FILE_COMMON|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(request==INVALID_HANDLE) return;
   string token=FileReadString(request);
   FileClose(request);
   StringTrimLeft(token);
   StringTrimRight(token);
   if(token=="" || token==last_test_token) return;
   last_test_token=token;
   int file=FileOpen(signals_file,FILE_COMMON|FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(file==INVALID_HANDLE) return;
   FileSeek(file,0,SEEK_END);
   string line="ID="+token+" | Type=TEST_OK | Symbol=BRIDGE | TF=ALL | Time="+
               TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+" | Value="+IntegerToString(sources)+
               " | BuyBuffer="+IntegerToString(InpBuyBuffer)+" | SellBuffer="+IntegerToString(InpSellBuffer)+
               " | Source=Sentinel Reader Test";
   FileWriteString(file,line+"\r\n");
   FileClose(file);
   Print("Sentinel: test acknowledged. Atomic sources detected: ",sources);
}

void ReadSource(const long chart_id,const int handle,const string indicator_name,
                const string symbol,const ENUM_TIMEFRAMES timeframe,const int status_handle)
{
   if(handle==INVALID_HANDLE || BarsCalculated(handle)<=0) return;
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   int first_shift=InpClosedBarOnly ? 1 : 0;
   int last_shift=1;
   for(int shift=first_shift;shift<=last_shift;shift++)
   {
      datetime bar_time=iTime(symbol,timeframe,shift);
      if(bar_time<=0) continue;
      double buy_values[1],sell_values[1];
      buy_values[0]=EMPTY_VALUE;
      sell_values[0]=EMPTY_VALUE;
      int buy_copied=CopyBuffer(handle,InpBuyBuffer,shift,1,buy_values);
      int sell_copied=CopyBuffer(handle,InpSellBuffer,shift,1,sell_values);
      if(status_handle!=INVALID_HANDLE && shift==first_shift)
      {
         string line="Version=1.30 | Symbol="+symbol+" | TF="+TimeframeName(timeframe)+
                     " | Bar="+TimeToString(bar_time,TIME_DATE|TIME_SECONDS)+
                     " | BuyBuffer="+IntegerToString(InpBuyBuffer)+" | BuyValue="+DoubleToString(buy_values[0],digits)+
                     " | BuyCopied="+IntegerToString(buy_copied)+" | SellBuffer="+IntegerToString(InpSellBuffer)+
                     " | SellValue="+DoubleToString(sell_values[0],digits)+" | SellCopied="+IntegerToString(sell_copied)+
                     " | Updated="+TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+
                     " | Mode=CENTRAL_MULTI_CHART_READ_ONLY | Indicator="+indicator_name+
                     " | ChartId="+IntegerToString(chart_id);
         FileWriteString(status_handle,line+"\r\n");
      }
      bool buy_signal=buy_copied==1 && IsSignalValue(buy_values[0]);
      bool sell_signal=sell_copied==1 && IsSignalValue(sell_values[0]);
      if(buy_signal && !sell_signal) AppendSignal("BUY",symbol,timeframe,bar_time,buy_values[0],digits);
      else if(sell_signal && !buy_signal) AppendSignal("SELL",symbol,timeframe,bar_time,sell_values[0],digits);
      else if(buy_signal && sell_signal) AppendSignal("CONFLICT",symbol,timeframe,bar_time,buy_values[0],digits);
   }
}

void ScanAtomicCharts()
{
   int status=FileOpen(status_file,FILE_COMMON|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   int sources=0;
   long chart_id=ChartFirst();
   while(chart_id>=0)
   {
      string symbol=ChartSymbol(chart_id);
      ENUM_TIMEFRAMES timeframe=(ENUM_TIMEFRAMES)ChartPeriod(chart_id);
      int windows=(int)ChartGetInteger(chart_id,CHART_WINDOWS_TOTAL);
      for(int window=0;window<windows;window++)
      {
         int total=ChartIndicatorsTotal(chart_id,window);
         for(int index=0;index<total;index++)
         {
            string name=ChartIndicatorName(chart_id,window,index);
            if(!IsAtomicIndicator(name)) continue;
            ResetLastError();
            int handle=ChartIndicatorGet(chart_id,window,name);
            if(handle==INVALID_HANDLE)
            {
               Print("Sentinel: cannot access '",name,"' on ",symbol," ",TimeframeName(timeframe),". Error ",GetLastError());
               continue;
            }
            sources++;
            ReadSource(chart_id,handle,name,symbol,timeframe,status);
         }
      }
      chart_id=ChartNext(chart_id);
   }
   if(status!=INVALID_HANDLE)
   {
      if(sources==0)
         FileWriteString(status,"Version=1.30 | Updated="+TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+
                         " | Mode=CENTRAL_MULTI_CHART_READ_ONLY | Sources=0\r\n");
      FileClose(status);
   }
   ProcessTestRequest(sources);
}

int OnInit()
{
   EventSetTimer(MathMax(1,InpRefreshSeconds));
   Print("Sentinel 1.30: central reader active in closed-bar mode. Scanning every open chart for existing Atomic Analyst indicators.");
   ScanAtomicCharts();
   return INIT_SUCCEEDED;
}

void OnTimer() { ScanAtomicCharts(); }

void OnDeinit(const int reason)
{
   EventKillTimer();
}
