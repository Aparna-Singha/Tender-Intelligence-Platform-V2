# Offline safety tests. No Docker daemon operations or staging environment reads.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tender-diagnostics.ps1') -LibraryOnly
$script:Passed = 0
function Check($Condition) {
    if (-not $Condition) { throw 'Offline assertion failed.' }
    $script:Passed++
}
function Reject([scriptblock]$Action) {
    $rejected = $false
    try { & $Action } catch { $rejected = $true }
    Check $rejected
}
function Clone($Object) { return $Object | ConvertTo-Json -Depth 60 | ConvertFrom-Json }
Check ((Get-Fingerprint @{ a = 1; b = 2 }) -ceq (Get-Fingerprint @{ b = 2; a = 1 }))
Check ((Get-Fingerprint @{ a = 1 }) -cne (Get-Fingerprint @{ a = 2 }))
Check ((Get-EnvironmentMap @('SAFE=a=b','API_TENDER_LATENCY_DIAGNOSTICS=true')).SAFE -ceq 'a=b')
$container = @'
{"Name":"/tender-intelligence-staging-api-1","Config":{"Labels":{"com.docker.compose.project":"tender-intelligence-staging","com.docker.compose.service":"api","com.docker.compose.container-number":"1","com.docker.compose.oneoff":"False"},"Env":["SAFE=dummy"],"Cmd":["node","dist/main.js"],"User":"node","Healthcheck":{"Retries":5}},"HostConfig":{"PortBindings":{"4000/tcp":[{"HostIp":"127.0.0.1","HostPort":"4000"}]},"PublishAllPorts":false,"NetworkMode":"backend","Memory":100,"SecurityOpt":["no-new-privileges:true"]},"Mounts":[],"NetworkSettings":{"Networks":{"backend":{"NetworkID":"synthetic"}}}}
'@ | ConvertFrom-Json
Assert-Identity $container
Assert-Loopback $container
Check $true
foreach ($field in @('project','service','container-number','oneoff')) {
    $bad = Clone $container
    $bad.Config.Labels.PSObject.Properties["com.docker.compose.$field"].Value = 'invalid'
    Reject { Assert-Identity $bad }
}
$bad = Clone $container; $bad.HostConfig.PortBindings.'4000/tcp'[0].HostIp = '0.0.0.0'
Reject { Assert-Loopback $bad }
$baseline = Get-ContainerPolicy $container
foreach ($change in @(
    { param($x) $x.Config.Cmd = @('sh') },
    { param($x) $x.HostConfig.Memory = 200 },
    { param($x) $x.Config.Healthcheck.Retries = 1 },
    { param($x) $x.HostConfig.SecurityOpt = @() },
    { param($x) $x.Mounts = @(@{ Source = 'unexpected' }) },
    { param($x) $x.NetworkSettings.Networks.backend.NetworkID = 'different' },
    { param($x) $x.Config.Env = @('SAFE=changed') }
)) {
    $bad = Clone $container; & $change $bad
    Check ((Get-ContainerPolicy $bad) -cne $baseline)
}
$bad = Clone $container; $bad.HostConfig.NetworkMode = 'host'
Reject { Get-ContainerPolicy $bad }
$id = '1188d64e-8644-4d81-8a34-235014014686'
$record = [pscustomobject]@{ event = 'tender_detail_stage_timing'; request_id = $id; status_code = 200; method = 'GET'; route = '/organisations/:organisationId/tenders/:tenderId'; stages_ms = [pscustomobject]@{ session_authentication = 1; organisation_authorization = 1; tender_primary_query = 1; response_mapping = 1; post_handler_pre_send = 1; send_to_response = 1; unattributed = 1 } }
Assert-Correlation @($record) $id $id 200
Check $true
foreach ($status in @(401,403,500)) { Reject { Assert-Correlation @($record) $id $id $status } }
Reject { Assert-Correlation @($record) $id 'different' 200 }
Reject { Assert-Correlation @() $id $id 200 }
Reject { Assert-Correlation @($record,$record) $id $id 200 }
$bad = Clone $record; $bad.stages_ms.tender_primary_query = -1
Reject { Assert-Correlation @($bad) $id $id 200 }
$bad = Clone $record; $bad.route = '/other'
Reject { Assert-Correlation @($bad) $id $id 200 }
$config = '{"name":"tender-intelligence-staging","services":{"api":{"image":"old","environment":{"SAFE":"dummy"},"networks":{"backend":null}},"worker":{"image":"unchanged"}},"networks":{"backend":{}}}' | ConvertFrom-Json
$policy = Get-ComposePolicy $config
$candidate = Clone $config; $candidate.services.api.image = 'candidate'
$candidate.services.api.environment | Add-Member NoteProperty API_TENDER_LATENCY_DIAGNOSTICS 'true'
Check ((Get-ComposePolicy $candidate) -ceq $policy)
$candidate.services.worker.image = 'changed'
Check ((Get-ComposePolicy $candidate) -cne $policy)
$Approved = $false
Reject { Stage-Candidate $null }
Reject { Change-Api $null 'Enable' }
$override = New-Override 'sha256:synthetic' 'true'
Check ($override.services.Count -eq 1 -and $override.services.api.environment.Count -eq 1)
# Mock the native boundary to verify planned mode mismatches stop before recreation.
function Read-DockerJson { return $script:Planned }
$script:Planned = Clone $config
$manifest = [pscustomobject]@{ StagingRoot = 'synthetic'; EnvironmentFile = 'synthetic'; ComposeFiles = @(); ComposePolicy = $policy }
Assert-PlannedConfig $manifest 'unused' 'old'
Check $true
$script:Planned.services.api.environment | Add-Member NoteProperty API_TENDER_LATENCY_DIAGNOSTICS 'true'
Reject { Assert-PlannedConfig $manifest 'unused' 'old' }
Assert-PlannedConfig $manifest 'unused' 'old' 'true'
Check $true
Reject { Assert-PlannedConfig $manifest 'unused' 'old' 'false' }
$script:Planned.services.api.image = 'unapproved'
Reject { Assert-PlannedConfig $manifest 'unused' 'old' 'true' }
& {
    # Exercise Stage itself, with all native boundaries replaced before approval.
    $Approved = $true
    $CandidateImage = 'synthetic-candidate'
    $BundleDirectory = Join-Path ([IO.Path]::GetTempPath()) ('nonexistent-stage-fixture-' + [guid]::NewGuid())
    $m = [pscustomobject]@{ OriginalId = 'original'; OriginalImage = 'old'; ApiPolicy = 'policy'; ImagePolicy = 'policy'; Revision = $script:Revision; StagingRoot = 'synthetic'; EnvironmentFile = 'synthetic'; ComposeFiles = @() }
    function Get-ProjectContainers { return @() }
    function Get-Api { return [pscustomobject]@{ Id = 'original'; Image = 'old' } }
    function Get-ContainerPolicy { return 'policy' }
    function Get-ImagePolicy { return 'policy' }
    function Assert-Environment { }
    function Read-DockerJson($Arguments) {
        if ($Arguments[0] -ceq 'image') {
            return [pscustomobject]@{ Id = 'sha256:synthetic'; Os = 'linux'; Architecture = 'amd64'; Config = [pscustomobject]@{ Labels = [pscustomobject]@{ 'org.opencontainers.image.revision' = $script:Revision } } }
        }
        return [pscustomobject]@{ services = [pscustomobject]@{ api = [pscustomobject]@{} } }
    }
    $script:Writes = 0
    $script:ProbeCalls = 0
    function Write-JsonFile { $script:Writes++; throw 'UNEXPECTED_WRITE' }
    function Invoke-Docker($Arguments) {
        $script:ProbeCalls++
        Check ($Arguments[0] -ceq 'run' -and $Arguments -contains '--rm' -and $Arguments -contains '--read-only')
        Check ($Arguments[([array]::IndexOf($Arguments,'--network') + 1)] -ceq 'none')
        Check ($Arguments[([array]::IndexOf($Arguments,'--entrypoint') + 1)] -ceq 'node')
        Check ($Arguments -contains 'sha256:synthetic' -and $Arguments -notcontains '--env' -and $Arguments -notcontains '--volume')
        throw 'INSTRUMENTATION_MISSING'
    }
    $reason = ''
    try { Stage-Candidate $m } catch { $reason = $_.Exception.Message }
    Check ($reason -ceq 'INSTRUMENTATION_MISSING')
    Check ($script:Writes -eq 0 -and $script:ProbeCalls -eq 1)
    # A separate recovery acknowledgement must stop recreation before any Docker call.
    $AcknowledgeUnrehearsedRecovery = $false
    Reject { Change-Api $m 'Enable' }
    Check ($script:ProbeCalls -eq 1)
}
Write-Output "PASS: $script:Passed offline safety assertions. No live operation tested."
