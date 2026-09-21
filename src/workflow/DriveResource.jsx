import React,{useId} from 'react';
import {ExternalLink,Link2} from 'lucide-react';
import {requestDriveUrls,validDriveUrl} from './drive-resources';
import './drive-resources.css';

export function DriveLinkField({value,onChange,disabled=false}){
 const hint=useId();
 return <label className="w-drive-field"><span>رابط Google Drive <small>اختياري</small></span><input type="url" value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} maxLength={2048} dir="ltr" inputMode="url" autoCapitalize="none" spellCheck={false} aria-describedby={hint} placeholder="https://drive.google.com/"/><small id={hint}>يمكنك إضافة رابط أو رفع ملفات أو استخدامهما معا وتأكد أن مشاركة الرابط تسمح للفريق بفتحه</small></label>;
}

export function DriveResource({url}){
 if(!validDriveUrl(url))return null;
 return <a className="w-drive-resource" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Link2 size={19} aria-hidden="true"/><span>فتح مرفقات Google Drive<small>يفتح في علامة تبويب جديدة</small></span><ExternalLink size={16} aria-hidden="true"/></a>;
}

export function RequestDriveResources({request}){
 return requestDriveUrls(request).map(url=><DriveResource key={url} url={url}/>);
}
