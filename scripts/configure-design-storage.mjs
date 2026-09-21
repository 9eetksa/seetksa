import {loadEnv} from 'vite';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
const env=loadEnv('development',process.cwd(),'');
if(!env.VITE_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Missing server storage configuration');
const db=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}});
// These are published website design images; work and customer files stay private.
const options={public:true,fileSizeLimit:5*1024*1024,allowedMimeTypes:['image/png','image/jpeg','image/webp']};
const existing=await db.storage.getBucket('platform-designs');
const result=existing.data?await db.storage.updateBucket('platform-designs',options):await db.storage.createBucket('platform-designs',options);
if(result.error)throw new Error(`Design storage configuration failed ${result.error.status||''}`);
const {data,error}=await db.storage.getBucket('platform-designs');
if(error||!data?.public||data.file_size_limit!==options.fileSizeLimit||JSON.stringify([...(data.allowed_mime_types||[])].sort())!==JSON.stringify([...options.allowedMimeTypes].sort()))throw new Error('Design storage verification failed');
console.log('Published design images configured with 5 MB and raster image restrictions');
