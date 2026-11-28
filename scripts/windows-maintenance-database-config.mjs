// Resolve only known local Windows database configurations. No connection or mutation.
export function resolveWindowsMaintenanceDatabase(config){
 if(!config||typeof config.DATABASE_URL!=='string'||!config.DATABASE_URL)throw Error('Managed database configuration required.');
 let url;
 try{url=new URL(config.DATABASE_URL);}catch{throw Error('Invalid managed database configuration.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='5433'||url.search||url.hash||!url.username||!url.password)throw Error('Unsupported managed database endpoint.');
 let user,password;
 try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);}catch{throw Error('Invalid managed database credentials.');}
 if(!password||password.includes('\0'))throw Error('Invalid managed database credentials.');
 const pilot=config.ARS_WINDOWS_PILOT==='1';
 if(config.ARS_WINDOWS_PILOT!==undefined&&!pilot)throw Error('Unsupported Windows installation mode.');
 const database=pilot?'hardware_pos_ars':'hardware_pos';
 const expectedUser=pilot?'ars':'postgres';
 if(url.pathname!=='/'+database||user!==expectedUser)throw Error('Database configuration does not match installation mode.');
 if(pilot&&(typeof config.ARS_WINDOWS_DB_PASSWORD!=='string'||config.ARS_WINDOWS_DB_PASSWORD!==password))throw Error('Pilot database credentials do not match.');
 return Object.freeze({database,container:pilot?'ars-windows-pilot-postgres':'hardware-pos-postgres',user,host:url.hostname==='[::1]'?'::1':url.hostname,port:5433,pilot,connection:Object.freeze({host:url.hostname==='[::1]'?'::1':url.hostname,port:5433,database,user,password,ssl:false,connectionTimeoutMillis:5000,query_timeout:15000})});
}
