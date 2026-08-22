export type NewsImpact='CRÍTICO'|'ALTO'|'MEDIO'|'BAJO';
export interface EnrichedNews extends NewsArticle{impact:NewsImpact;score:number;assets:string[];topic:string;ageHours:number}
const GROUPS=[
 {topic:'Política monetaria',terms:['interest rate','monetary policy','federal funds','inflation','central bank','ecb','federal reserve','fed '],assets:['USD','EUR/USD','DXY','Bonos','NASDAQ','XAU/USD','BTC/USD'],weight:32},
 {topic:'Geopolítica',terms:['war','attack','sanction','tariff','conflict','invasion'],assets:['XAU/USD','Petróleo','Índices','Divisas'],weight:34},
 {topic:'Cripto',terms:['bitcoin','ethereum','crypto','stablecoin','sec '],assets:['BTC/USD','ETH/USD','Cripto'],weight:24},
 {topic:'Energía',terms:['oil','opec','natural gas','crude'],assets:['WTI','Brent','CAD','Índices'],weight:24},
 {topic:'Sistema financiero',terms:['bank failure','liquidity crisis','default','credit downgrade','financial stability'],assets:['Bancos','Índices','Bonos','XAU/USD'],weight:38},
];
export function enrichNews(article:NewsArticle,now=new Date()):EnrichedNews{
 const text=`${article.title} ${article.summary}`.toLowerCase();const matches=GROUPS.filter(g=>g.terms.some(term=>text.includes(term)));const ageHours=Math.max(0,(now.getTime()-new Date(article.publishedAt).getTime())/3600000);const recency=ageHours<=6?25:ageHours<=24?15:ageHours<=72?7:0;const topicWeight=Math.max(8,...matches.map(x=>x.weight));const score=Math.min(100,Math.round(article.credibility*.35+topicWeight+recency));const impact:NewsImpact=score>=85?'CRÍTICO':score>=70?'ALTO':score>=50?'MEDIO':'BAJO';return{...article,impact,score,assets:[...new Set(matches.flatMap(x=>x.assets))],topic:matches[0]?.topic??'Mercados generales',ageHours};
}
export function rankNews(snapshot:NewsSnapshot,now=new Date()){return snapshot.articles.map(x=>enrichNews(x,now)).sort((a,b)=>b.score-a.score||a.ageHours-b.ageHours)}
