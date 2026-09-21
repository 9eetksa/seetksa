// Presentation only The output RPC independently enforces every restriction
export function outputDepartmentChoices(services,part,requests=[]){
 const unavailable=new Set(requests.filter(row=>row.part_id===part?.id&&['pending','rejected'].includes(row.status)).map(row=>row.target_service_id));
 return services.filter(service=>service.active!==false&&service.id!==part?.service_id&&!unavailable.has(service.id));
}

export function validateOutputSelection(rows,choices){
 if(!rows.length)return 'اختر قسما واحدا على الأقل';
 if(new Set(rows.map(row=>row.service_id)).size!==rows.length)return 'اختر كل قسم مرة واحدة';
 if(rows.some(row=>!choices.some(service=>service.id===row.service_id)))return 'أحد الأقسام المختارة لم يعد متاحا لهذه المهمة احذفه من الاختيار';
 if(rows.some(row=>row.reason.trim().length<3||row.reason.length>4000))return 'وضح المخرجات المطلوبة من كل قسم بثلاثة أحرف على الأقل';
 return '';
}
