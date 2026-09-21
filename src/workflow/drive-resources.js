export const driveSpecificationKey='رابط Google Drive';
export const additionalDriveKey='additional_drive_urls';

export function validDriveUrl(value){
 return typeof value==='string'&&value.length<=2048&&/^https:\/\/(?:drive\.google\.com|docs\.google\.com)\/[^\s\\<>"\u0000-\u001f\u007f]+$/i.test(value);
}

export function normalizeDriveUrl(value=''){
 const url=value.trim();
 if(url&&!validDriveUrl(url))throw new Error('invalid_drive_url');
 return url;
}

export function requestDriveUrl(request){
 const value=request?.specifications?.[driveSpecificationKey];
 return validDriveUrl(value)?value:'';
}

export function requestDriveUrls(request){
 const extra=request?.specifications?.[additionalDriveKey];
 return [...new Set([requestDriveUrl(request),...(Array.isArray(extra)?extra:[])].filter(validDriveUrl))];
}
