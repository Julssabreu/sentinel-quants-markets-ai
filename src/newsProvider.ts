export type NewsProviderStatus='NEWS_PROVIDER_ONLINE'|'NEWS_PROVIDER_DEGRADED'|'NEWS_PROVIDER_OFFLINE'|'NEWS_PROVIDER_NOT_CONFIGURED';
export interface RawNewsItem{providerId:string;sourceId:string;providerTimestamp:string;headline:string;storyReference:string|null;metadata?:Record<string,unknown>;}
export interface NewsProvider{readonly id:string;status():Promise<NewsProviderStatus>;search(query:string):Promise<RawNewsItem[]>;receive?(cursor?:string):Promise<RawNewsItem[]>;}
export interface ReutersLsegConfiguration{appKey?:string;username?:string;endpoint?:string;entitled:boolean;}
export class ReutersLsegNewsProvider implements NewsProvider{
  readonly id='REUTERS_LSEG';constructor(private readonly configuration:ReutersLsegConfiguration){}
  async status():Promise<NewsProviderStatus>{return this.configuration.entitled&&this.configuration.appKey?'NEWS_PROVIDER_OFFLINE':'NEWS_PROVIDER_NOT_CONFIGURED'}
  async search(_query:string):Promise<RawNewsItem[]>{if(!this.configuration.entitled||!this.configuration.appKey)throw new Error('Reuters/LSEG no configurado: se requieren credenciales y entitlements oficiales.');throw new Error('Adaptador Reuters/LSEG preparado, conexión oficial todavía no implementada.');}
}
