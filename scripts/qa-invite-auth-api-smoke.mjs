import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Explicitly opt-in Production smoke: no email, password, activation or session.
// The only persistent mutation is a disposable pending identity, removed below.
assert.ok(process.argv.includes('--production-smoke'));
process.loadEnvFile('C:/Users/TRAVKIN/Downloads/CodecSaaS/.worktrees/compact-open-tickets-20260918/.env.production.local');
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'bhsemlvmkikpntabctml.supabase.co');
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY);
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const company='88435427-182c-48e1-a77c-9a5b65161ed5'; // Existing test tenant only.
const email=`p0-invite-smoke-${randomUUID()}@example.invalid`;
const {data,error}=await db.auth.admin.createUser({
  email,email_confirm:false,
  user_metadata:{full_name:'P0 disposable invite smoke',role:'director',invited_by_company:company},
  app_metadata:{generic_invitation_v1:{state:'provisioning',company_id:company,role:'director',is_owner:false}},
});
if(error){
  console.log(JSON.stringify({created:false,code:error.code,status:error.status,message:error.message}));
  assert.ok(process.argv.includes('--expect-failure'));
} else {
assert.ok(data.user?.id);
try {
  assert.ok(!process.argv.includes('--expect-failure'),'Unexpected baseline success');
  assert.equal(data.user.email_confirmed_at,undefined);
  const result=await db.from('profiles').select('role,company_id,is_owner,status').eq('id',data.user.id).single();
  assert.ifError(result.error);
  assert.deepEqual(result.data,{role:'director',company_id:company,is_owner:false,status:'pending'});
  console.log(JSON.stringify({created:true,profileVerified:true,role:'director',pending:true,emailSent:false}));
} finally {
  const deleted=await db.auth.admin.deleteUser(data.user.id);
  assert.ifError(deleted.error);
  const check=await db.from('profiles').select('id').eq('id',data.user.id);
  assert.ifError(check.error);
  assert.equal(check.data.length,0);
  console.log(JSON.stringify({probeRemoved:true}));
}
}
