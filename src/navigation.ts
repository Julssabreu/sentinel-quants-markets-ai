export const ACTIVE_VIEWS=['Centro global','Oportunidades','Analizar activo','Estrategias','Riesgo','Cartera','Noticias y macro','Julssbot AI','Alertas','Listas de vigilancia','Avisos WhatsApp','Historial','Laboratorio']as const;
export type ActiveView=typeof ACTIVE_VIEWS[number];
export const hasView=(value:string):value is ActiveView=>(ACTIVE_VIEWS as readonly string[]).includes(value);
