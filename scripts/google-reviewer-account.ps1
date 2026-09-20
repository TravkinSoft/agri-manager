param([ValidateSet('Create','Verify','Suspend','VerifyBlocked','Activate')][string]$Mode = 'Verify')
$ErrorActionPreference = 'Stop'
$accountEmail = 'travkin.group+googleplay@gmail.com'
$companyName = 'TravkinFlow Google Play Demo'
$credentialPath = 'C:\Users\TRAVKIN\Documents\TravkinFlow Secure\Google Play\reviewer-account.dpapi.xml'
$settings = @{}
foreach ($line in Get-Content -LiteralPath 'C:\Users\TRAVKIN\Downloads\CodecSaaS\project-bolt-sb1-hjjzpfey-4\project\.env') {
  if ($line -match '^([A-Z_][A-Z0-9_]*)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}
$api = $settings['NEXT_PUBLIC_SUPABASE_URL'].TrimEnd('/')
if ($api -ne 'https://bhsemlvmkikpntabctml.supabase.co') { throw 'Wrong Supabase project; no action performed.' }
$adminHeaders = @{apikey=$settings['SUPABASE_SERVICE_ROLE_KEY']; Authorization=('Bearer '+$settings['SUPABASE_SERVICE_ROLE_KEY'])}
if ($Mode -eq 'Activate') {
  $exactId='8f07365f-8be5-4ae4-98c8-b96148b324bf'
  $profile=Invoke-RestMethod -Uri ($api+'/rest/v1/profiles?select=id,company_id,role,status&id=eq.'+$exactId) -Headers $adminHeaders
  if ($profile.Count -ne 1 -or $profile[0].company_id -ne '9fb971ad-b5b1-4284-8b06-c4325d385f6a' -or $profile[0].role -ne 'company_admin' -or $profile[0].status -ne 'active') {throw 'Exact active demo profile required before unban.'}
  $existingUser=Invoke-RestMethod -Uri ($api+'/auth/v1/admin/users/'+$exactId) -Headers $adminHeaders
  if ($existingUser.email -ne $accountEmail) {throw 'Activate identity mismatch.'}
  $activated=Invoke-RestMethod -Method Put -Uri ($api+'/auth/v1/admin/users/'+$exactId) -Headers $adminHeaders -ContentType 'application/json' -Body '{"ban_duration":"none"}'
  [pscustomobject]@{userId=$activated.id;unbanned=(!$activated.banned_until -or [datetime]$activated.banned_until -le [datetime]::UtcNow)} | ConvertTo-Json
} elseif ($Mode -eq 'Suspend') {
  $exactId='8f07365f-8be5-4ae4-98c8-b96148b324bf'
  $existingUser=Invoke-RestMethod -Uri ($api+'/auth/v1/admin/users/'+$exactId) -Headers $adminHeaders
  if ($existingUser.email -ne $accountEmail) { throw 'Suspend identity mismatch.' }
  $suspended=Invoke-RestMethod -Method Put -Uri ($api+'/auth/v1/admin/users/'+$exactId) -Headers $adminHeaders -ContentType 'application/json' -Body '{"ban_duration":"876000h"}'
  [pscustomobject]@{userId=$suspended.id;blocked=([datetime]$suspended.banned_until -gt [datetime]::UtcNow)} | ConvertTo-Json
} elseif ($Mode -eq 'Create') {
  if (Test-Path -LiteralPath $credentialPath) { throw 'Credential already exists. Refusing duplicate provisioning.' }
  $existing = Invoke-RestMethod -Uri ($api+'/rest/v1/profiles?select=id&email=eq.'+[uri]::EscapeDataString($accountEmail)) -Headers $adminHeaders
  if ($existing.Count -gt 0) { throw 'Account already exists. Refusing to modify it.' }
  $randomBytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($randomBytes)
  $rng.Dispose()
  $generatedPassword = [Convert]::ToBase64String($randomBytes)+'aA1!'
  $securePassword = ConvertTo-SecureString -String $generatedPassword -AsPlainText -Force
  $credential = [PSCredential]::new($accountEmail,$securePassword)
  $credential | Export-Clixml -LiteralPath $credentialPath
  $body = @{email=$accountEmail;password=$generatedPassword;email_confirm=$true;user_metadata=@{full_name='Google Play Reviewer';company_name=$companyName}} | ConvertTo-Json -Depth 5
  try {
    $created = Invoke-RestMethod -Method Post -Uri ($api+'/auth/v1/admin/users') -Headers $adminHeaders -ContentType 'application/json' -Body $body
  } catch { throw 'Auth creation did not return success. Reconcile exact email before retry; encrypted credential retained.' }
  $profile = Invoke-RestMethod -Uri ($api+'/rest/v1/profiles?select=id,company_id,role,status,is_owner&id=eq.'+$created.id) -Headers $adminHeaders
  [pscustomobject]@{createdUserId=$created.id;profile=$profile;credentialStorage='Windows DPAPI outside Git';emailConfirmed=([bool]$created.email_confirmed_at)} | ConvertTo-Json -Depth 5
  $generatedPassword=$null; $body=$null
} elseif ($Mode -eq 'VerifyBlocked') {
  $credential = Import-Clixml -LiteralPath $credentialPath
  if ($credential.UserName -ne $accountEmail) { throw 'Credential identity mismatch.' }
  $body = @{email=$accountEmail;password=$credential.GetNetworkCredential().Password} | ConvertTo-Json
  $response=Invoke-WebRequest -Method Post -Uri ($api+'/auth/v1/token?grant_type=password') -Headers @{apikey=$settings['NEXT_PUBLIC_SUPABASE_ANON_KEY']} -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
  $result=$response.Content | ConvertFrom-Json
  if ([int]$response.StatusCode -ne 400 -or $result.error_code -ne 'user_banned') { throw 'Expected banned-account rejection was not confirmed.' }
  [pscustomobject]@{loginBlocked=$true;httpStatus=[int]$response.StatusCode;reason=$result.error_code} | ConvertTo-Json
  $body=$null
} else {
  $credential = Import-Clixml -LiteralPath $credentialPath
  if ($credential.UserName -ne $accountEmail) { throw 'Credential identity mismatch.' }
  $publicHeaders = @{apikey=$settings['NEXT_PUBLIC_SUPABASE_ANON_KEY']}
  $body = @{email=$accountEmail;password=$credential.GetNetworkCredential().Password} | ConvertTo-Json
  $login = Invoke-RestMethod -Method Post -Uri ($api+'/auth/v1/token?grant_type=password') -Headers $publicHeaders -ContentType 'application/json' -Body $body
  $userHeaders = @{apikey=$settings['NEXT_PUBLIC_SUPABASE_ANON_KEY'];Authorization=('Bearer '+$login.access_token)}
  $profile = Invoke-RestMethod -Uri ($api+'/rest/v1/profiles?select=id,role,status,company_id') -Headers $userHeaders
  $companies = Invoke-RestMethod -Uri ($api+'/rest/v1/companies?select=id,name') -Headers $userHeaders
  if ($profile.Count -ne 1 -or $profile[0].id -ne $login.user.id -or $profile[0].role -ne 'company_admin' -or $profile[0].status -ne 'active') { throw 'Reviewer profile scope invalid.' }
  if ($companies.Count -ne 1 -or $companies[0].name -ne $companyName -or $companies[0].id -ne $profile[0].company_id) { throw 'Reviewer company scope invalid.' }
  $checks=@()
  foreach ($route in @('/api/auth/actor','/api/crop-structure/bootstrap','/api/global-admin/companies')) {
    try { $response=Invoke-WebRequest -Uri ('https://travkinflow.com'+$route) -Headers @{Authorization=('Bearer '+$login.access_token)} -SkipHttpErrorCheck; $checks += @{route=$route;status=[int]$response.StatusCode} } catch { $checks += @{route=$route;status='network-error'} }
  }
  Invoke-RestMethod -Method Post -Uri ($api+'/auth/v1/logout?scope=local') -Headers $userHeaders | Out-Null
  $second = Invoke-RestMethod -Method Post -Uri ($api+'/auth/v1/token?grant_type=password') -Headers $publicHeaders -ContentType 'application/json' -Body $body
  Invoke-RestMethod -Method Post -Uri ($api+'/auth/v1/logout?scope=local') -Headers @{apikey=$publicHeaders.apikey;Authorization=('Bearer '+$second.access_token)} | Out-Null
  [pscustomobject]@{login='PASS';repeatLogin='PASS';logout='PASS';visibleCompanies=$companies.Count;visibleProfiles=$profile.Count;company=$companies[0].name;role=$profile[0].role;apiChecks=$checks} | ConvertTo-Json -Depth 5
  $body=$null; $login=$null; $second=$null
}
