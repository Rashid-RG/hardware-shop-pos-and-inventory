import type {Pool,PoolClient} from 'pg';

export const positionKinds=['Fixed asset','Other asset','Loan liability','Tax liability','Other liability','Opening equity','Retained earnings'] as const;
export type PositionKind=typeof positionKinds[number];

export async function initPositionRegisters(db:Pool|PoolClient){
 await db.query(`CREATE TABLE IF NOT EXISTS ars_position_register (
 id TEXT PRIMARY KEY,shop_id TEXT NOT NULL,reference TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('Fixed asset','Other asset','Loan liability','Tax liability','Other liability','Opening equity','Retained earnings')),
 label TEXT NOT NULL,amount NUMERIC(16,2) NOT NULL,effective_date DATE NOT NULL,evidence TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(shop_id,kind,reference,effective_date),
 CHECK(amount>=0 OR kind IN ('Opening equity','Retained earnings'))
 );
 CREATE INDEX IF NOT EXISTS ars_position_register_shop ON ars_position_register(shop_id,kind,reference,effective_date DESC);`);
}

export async function listPositionRegisters(db:Pool|PoolClient,shopId:string){
 const result=await db.query(`SELECT DISTINCT ON(kind,reference) id,reference,kind,label,amount,effective_date::text AS day,evidence,recorded_by
 FROM ars_position_register WHERE shop_id=$1 AND effective_date<=(NOW() AT TIME ZONE 'Asia/Colombo')::date
 ORDER BY kind,reference,effective_date DESC`,[shopId]);
 return result.rows.map(r=>({...r,amount:Number(r.amount)}));
}

/** Register a verified carrying balance, not a cash transaction or journal posting. */
export async function recordPositionBalance(db:Pool,input:{id:string;shopId:string;reference:string;kind:PositionKind;label:string;amount:number;effectiveDate:string;evidence:string;recordedBy:string}){
 const {id,shopId,kind,amount,effectiveDate,recordedBy}=input;
 const reference=input.reference.trim(),label=input.label.trim(),evidence=input.evidence.trim();
 if(!id||!shopId||!recordedBy||!positionKinds.includes(kind)||!reference||reference.length>120||!label||label.length>160||!evidence||evidence.length>500||!Number.isFinite(amount)||Math.abs(amount)>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.001||(amount<0&&!['Opening equity','Retained earnings'].includes(kind))||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||!Number.isFinite(Date.parse(effectiveDate))||new Date(effectiveDate).toISOString().slice(0,10)!==effectiveDate||effectiveDate<'1900-01-01')throw Error('Valid evidenced carrying balance required.');
 const client=await db.connect();
 try{
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
 const old=await client.query('SELECT *,effective_date::text AS day FROM ars_position_register WHERE id=$1',[id]);
 if(old.rowCount){
 const r=old.rows[0];
 if(r.shop_id!==shopId||r.reference!==reference||r.kind!==kind||r.label!==label||Number(r.amount)!==amount||r.day!==effectiveDate||r.evidence!==evidence||r.recorded_by!==recordedBy)throw Error('Position request identifier already used.');
 await client.query('COMMIT');return {id,replayed:true};
 }
 const day=await client.query("SELECT (NOW() AT TIME ZONE 'Asia/Colombo')::date::text AS day");
 if(effectiveDate>day.rows[0].day)throw Error('Future carrying balances are not allowed.');
 const inserted=await client.query(`INSERT INTO ars_position_register(id,shop_id,reference,kind,label,amount,effective_date,evidence,recorded_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(shop_id,kind,reference,effective_date) DO NOTHING RETURNING id`,[id,shopId,reference,kind,label,amount,effectiveDate,evidence,recordedBy]);
 if(!inserted.rowCount)throw Error('A balance already exists for this reference and date. Audited correction required.');
 await client.query('COMMIT');return {id,replayed:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
