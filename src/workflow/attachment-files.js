import {repository} from './data';

export function groupDeliveryFiles(deliveries){
 const groups=new Map();
 for(const file of deliveries){
  const key=file.batch_id||file.id;
  if(!groups.has(key))groups.set(key,{...file,files:[]});
  groups.get(key).files.push(file);
 }
 return [...groups.values()];
}

export async function saveOriginal(file){
 const url=await repository.download(file);
 const link=document.createElement('a');
 link.href=url;
 link.download=file.filename;
 link.rel='noopener noreferrer';
 link.hidden=true;
 document.body.appendChild(link);
 // The signed response requests attachment disposition with the original name
 // No new tab and no conversion or full-file buffering in application memory
 try{link.click();}finally{link.remove();}
}
