import {loadEnv} from 'vite';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';

// Keep client originals private and use the project's configured Storage limit
// without a second per-bucket size cap or file type allowlist
const env=loadEnv('development',process.cwd(),'');
if(!env.VITE_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Storage configuration requires server credentials');
const db=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}});
const {error}=await db.storage.updateBucket('work-files',{public:false,fileSizeLimit:null,allowedMimeTypes:null});
if(error)throw new Error(`Storage configuration failed with status ${error.status||'unknown'}`);
const {data,error:readError}=await db.storage.getBucket('work-files');
if(readError||data.public||data.file_size_limit!==null||data.allowed_mime_types!==null)throw new Error('Storage configuration did not match the requested settings');
console.log('Work files remain private with project limits and no bucket type restriction');
