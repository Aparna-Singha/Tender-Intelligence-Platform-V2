# Windows PowerShell 5.1+. No live operation is performed merely by loading this file.
[CmdletBinding()]
param(
    [ValidateSet('Capture', 'Stage', 'Preflight', 'Enable', 'Disable', 'Rollback', 'Correlate')]
    [string]$Action = 'Preflight',
    [string]$BundleDirectory = (Join-Path $env:LOCALAPPDATA 'BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review'),
    [string]$CandidateImage,
    [string]$RequestId,
    [string]$ResponseRequestId,
    [int]$BrowserStatus = 0,
    [switch]$Approved,
    [switch]$AcknowledgeUnrehearsedRecovery,
    [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SafeFailure = 'Unexpected operator error; raw output suppressed.'
$script:Context = 'desktop-linux'
$script:Project = 'tender-intelligence-staging'
$script:ApiName = 'tender-intelligence-staging-api-1'
$script:Revision = 'e264f2722f4f2f187fcbaae6b5501ca0bbd55049'
$script:Flag = 'API_TENDER_LATENCY_DIAGNOSTICS'

function Assert-Safe($Condition, [string]$Message) {
    if (-not $Condition) { $script:SafeFailure = $Message; throw $Message }
}

function Get-Value($Object, [string]$Name, $Default = $null) {
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function ConvertTo-Canonical($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [System.Collections.IDictionary]) {
        $pairs = foreach ($key in @($Value.Keys | Sort-Object)) {
            (ConvertTo-Json ([string]$key) -Compress) + ':' + (ConvertTo-Canonical $Value[$key])
        }
        return '{' + ($pairs -join ',') + '}'
    }
    if ($Value -is [pscustomobject]) {
        $map = @{}
        foreach ($p in $Value.PSObject.Properties) { $map[$p.Name] = $p.Value }
        return ConvertTo-Canonical $map
    }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        $items = foreach ($item in $Value) { ConvertTo-Canonical $item }
        return '[' + ($items -join ',') + ']'
    }
    return ConvertTo-Json $Value -Compress
}

function Get-Fingerprint($Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((ConvertTo-Canonical $Value))))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Invoke-Docker([string[]]$Arguments) {
    # All output, including stderr, stays in memory. Never emit native errors.
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $captured = & docker.exe --context $script:Context @Arguments 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    Assert-Safe ($code -eq 0) 'Docker command failed; raw output suppressed. Stop and review privately.'
    return ($captured -join "`n")
}

function Read-DockerJson([string[]]$Arguments) {
    return ConvertFrom-Json (Invoke-Docker $Arguments)
}

function Get-EnvironmentMap($Entries) {
    $map = @{}
    foreach ($entry in $Entries) {
        $pair = $entry.Split('=', 2)
        Assert-Safe ($pair.Count -eq 2) 'Malformed environment entry.'
        if ($pair[0] -cne $script:Flag) { $map[$pair[0]] = $pair[1] }
    }
    return $map
}

function Get-ImagePolicy($Image) {
    $copy = $Image.Config | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $copy.PSObject.Properties.Remove('Env')
    $labels = Get-Value $copy 'Labels'
    if ($null -ne $labels) { $labels.PSObject.Properties.Remove('org.opencontainers.image.revision') }
    # Missing labels and an empty label map have the same meaning.
    if ($null -eq $labels -or @($labels.PSObject.Properties).Count -eq 0) {
        $copy | Add-Member -Force NoteProperty Labels $null
    }
    return Get-Fingerprint $copy
}

function Get-ContainerPolicy($Container) {
    $config = $Container.Config | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    foreach ($key in @('Hostname', 'Image', 'Env', 'Labels')) { $config.PSObject.Properties.Remove($key) }
    $hostConfig = $Container.HostConfig | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    # Docker may choose either attached network as its primary; membership/IDs are checked below.
    $hostConfig.PSObject.Properties.Remove('NetworkMode')
    $hostConfig.PSObject.Properties.Remove('ConsoleSize')
    $networks = @{}
    foreach ($p in $Container.NetworkSettings.Networks.PSObject.Properties) { $networks[$p.Name] = $p.Value.NetworkID }
    Assert-Safe ($networks.ContainsKey($Container.HostConfig.NetworkMode)) 'Unexpected API network mode.'
    return Get-Fingerprint @{ Config = $config; Host = $hostConfig; Mounts = $Container.Mounts; Networks = $networks; Environment = (Get-EnvironmentMap $Container.Config.Env) }
}

function Assert-Identity($Container) {
    Assert-Safe ($Container.Name -ceq ('/' + $script:ApiName)) 'API container name mismatch.'
    Assert-Safe ((Get-Value $Container.Config.Labels 'com.docker.compose.project') -ceq $script:Project) 'Compose project mismatch.'
    Assert-Safe ((Get-Value $Container.Config.Labels 'com.docker.compose.service') -ceq 'api') 'Compose service mismatch.'
    Assert-Safe ((Get-Value $Container.Config.Labels 'com.docker.compose.container-number') -ceq '1') 'Unexpected API replica.'
    Assert-Safe ((Get-Value $Container.Config.Labels 'com.docker.compose.oneoff') -ieq 'False') 'One-off container is not the API service.'
}

function Assert-Loopback($Container) {
    $bindings = $Container.HostConfig.PortBindings
    Assert-Safe (@($bindings.PSObject.Properties).Count -eq 1) 'Unexpected published API ports.'
    $port = @(Get-Value $bindings '4000/tcp')
    Assert-Safe ($port.Count -eq 1 -and $port[0].HostIp -ceq '127.0.0.1' -and $port[0].HostPort -ceq '4000') 'API must publish only 127.0.0.1:4000.'
    Assert-Safe (-not $Container.HostConfig.PublishAllPorts) 'Publish-all-ports is forbidden.'
}

function Get-ProjectContainers {
    $ids = (Invoke-Docker @('ps', '-aq', '--filter', "label=com.docker.compose.project=$script:Project")) -split '\s+' | Where-Object { $_ }
    Assert-Safe (@($ids).Count -ge 3) 'Staging project containers not found.'
    return @(Read-DockerJson (@('inspect') + @($ids)))
}

function Get-Api($Containers, [switch]$AllowAbsent) {
    $apis = @($Containers | Where-Object { (Get-Value $_.Config.Labels 'com.docker.compose.service') -ceq 'api' })
    if ($AllowAbsent -and $apis.Count -eq 0) { return $null }
    Assert-Safe ($apis.Count -eq 1) 'Expected exactly one API service container.'
    Assert-Identity $apis[0]
    return $apis[0]
}

function Get-ProtectedServices($Containers, [switch]$IncludeStartTime) {
    $map = @{}
    foreach ($c in $Containers) {
        $service = Get-Value $c.Config.Labels 'com.docker.compose.service'
        if ($service -ceq 'api') { continue }
        Assert-Safe (@('worker', 'redis', 'clamav') -ccontains $service) 'Unexpected service in staging project.'
        Assert-Safe (-not $map.ContainsKey($service)) 'Duplicate protected service.'
        $item = @{ Id = $c.Id; Image = $c.Image; Policy = (Get-Fingerprint @{ Config = $c.Config; Host = $c.HostConfig; Mounts = $c.Mounts }) }
        if ($IncludeStartTime) { $item.StartedAt = $c.State.StartedAt; $item.Running = $c.State.Running }
        $map[$service] = $item
    }
    Assert-Safe ($map.Count -eq 3) 'Worker, Redis and ClamAV must remain present.'
    return Get-Fingerprint $map
}

function Get-ComposeArguments($Manifest, [string]$Override) {
    $args = @('compose', '--project-name', $script:Project, '--project-directory', $Manifest.StagingRoot, '--env-file', $Manifest.EnvironmentFile)
    foreach ($file in $Manifest.ComposeFiles) { $args += @('-f', $file) }
    if ($Override) { $args += @('-f', $Override) }
    return $args
}

function Get-ComposePolicy($Config) {
    $copy = $Config | ConvertTo-Json -Depth 60 | ConvertFrom-Json
    $copy.services.api.image = '__approved_image__'
    $copy.services.api.environment.PSObject.Properties.Remove($script:Flag)
    return Get-Fingerprint $copy
}

function Assert-ComposeBaseline($Config, $Api, $Image) {
    Assert-Safe ($Config.name -ceq $script:Project) 'Resolved Compose project mismatch.'
    $s = $Config.services.api
    $allowed = @('build','cpus','command','depends_on','entrypoint','environment','healthcheck','image','init','logging','mem_limit','networks','pids_limit','ports','restart','security_opt')
    foreach ($p in $s.PSObject.Properties) { Assert-Safe ($allowed -ccontains $p.Name) 'Unsupported API Compose setting; review required.' }
    Assert-Loopback $Api
    Assert-Safe (@($Api.Mounts).Count -eq 0) 'Unexpected API mount.'
    Assert-Safe (-not $Api.HostConfig.Privileged -and $Api.HostConfig.Init -and $Api.Config.User -ceq 'node') 'Unexpected API privilege, init or user.'
    Assert-Safe ((Get-Fingerprint @($Api.HostConfig.SecurityOpt)) -ceq (Get-Fingerprint @('no-new-privileges:true'))) 'Unexpected API security options.'
    Assert-Safe ($s.ports.Count -eq 1 -and $s.ports[0].host_ip -ceq '127.0.0.1' -and [string]$s.ports[0].published -ceq '4000' -and $s.ports[0].target -eq 4000 -and $s.ports[0].protocol -ceq 'tcp') 'Resolved API port differs.'
    Assert-Safe ([long]$s.mem_limit -eq $Api.HostConfig.Memory -and [long]([double]$s.cpus * 1000000000) -eq $Api.HostConfig.NanoCpus -and $s.pids_limit -eq $Api.HostConfig.PidsLimit) 'Resource settings differ from running API.'
    Assert-Safe ($s.init -eq $Api.HostConfig.Init -and $s.restart -ceq $Api.HostConfig.RestartPolicy.Name) 'Init/restart settings differ.'
    Assert-Safe ((Get-Fingerprint @($s.security_opt)) -ceq (Get-Fingerprint @($Api.HostConfig.SecurityOpt))) 'Security settings differ.'
    Assert-Safe ($s.logging.driver -ceq $Api.HostConfig.LogConfig.Type -and (Get-Fingerprint $s.logging.options) -ceq (Get-Fingerprint $Api.HostConfig.LogConfig.Config)) 'Logging policy differs.'
    $command = Get-Value $s 'command'; if ($null -eq $command) { $command = $Image.Config.Cmd }
    $entrypoint = Get-Value $s 'entrypoint'; if ($null -eq $entrypoint) { $entrypoint = $Image.Config.Entrypoint }
    Assert-Safe ((Get-Fingerprint $command) -ceq (Get-Fingerprint $Api.Config.Cmd) -and (Get-Fingerprint $entrypoint) -ceq (Get-Fingerprint $Api.Config.Entrypoint)) 'Command or entrypoint differs.'
    # This procedure supports exactly the reviewed health policy; any change requires review.
    Assert-Safe ($s.healthcheck.interval -ceq '30s' -and $s.healthcheck.timeout -ceq '5s' -and $s.healthcheck.start_period -ceq '1m0s' -and $s.healthcheck.retries -eq 5) 'Unexpected Compose health timings.'
    Assert-Safe ($Api.Config.Healthcheck.Interval -eq 30000000000 -and $Api.Config.Healthcheck.Timeout -eq 5000000000 -and $Api.Config.Healthcheck.StartPeriod -eq 60000000000 -and $Api.Config.Healthcheck.Retries -eq 5 -and (Get-Fingerprint $s.healthcheck.test) -ceq (Get-Fingerprint $Api.Config.Healthcheck.Test)) 'Running health policy differs.'
    $expectedNetworks = @($s.networks.PSObject.Properties | ForEach-Object { (Get-Value $Config.networks $_.Name).name } | Sort-Object)
    Assert-Safe ((Get-Fingerprint $expectedNetworks) -ceq (Get-Fingerprint @($Api.NetworkSettings.Networks.PSObject.Properties.Name | Sort-Object))) 'Network membership differs.'
    Assert-Environment $s $Image $Api
}

function Assert-Environment($Service, $Image, $Api) {
    $expected = Get-EnvironmentMap $Image.Config.Env
    foreach ($p in $Service.environment.PSObject.Properties) { if ($p.Name -cne $script:Flag) { $expected[$p.Name] = [string]$p.Value } }
    Assert-Safe ((Get-Fingerprint $expected) -ceq (Get-Fingerprint (Get-EnvironmentMap $Api.Config.Env))) 'Environment drift detected; values suppressed.'
}

function Assert-RestrictedDirectory([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    Assert-Safe (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'Reparse-point bundle directory is forbidden.'
    $acl = Get-Acl -LiteralPath $Path
    Assert-Safe $acl.AreAccessRulesProtected 'Bundle ACL must disable inherited access.'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        Assert-Safe (@($sid, 'S-1-5-18') -contains $rule.IdentityReference.Value) 'Unexpected bundle ACL principal.'
    }
    foreach ($child in Get-ChildItem -LiteralPath $Path -Force) {
        Assert-Safe (-not $child.PSIsContainer -and -not ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'Unexpected bundle directory or link.'
        foreach ($rule in (Get-Acl -LiteralPath $child.FullName).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            Assert-Safe (@($sid, 'S-1-5-18') -contains $rule.IdentityReference.Value) 'Unexpected artifact ACL principal.'
        }
    }
}

function Write-JsonFile([string]$Path, $Value) {
    Assert-Safe (-not (Test-Path -LiteralPath $Path)) 'Refusing to overwrite an existing operator artifact.'
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 60), (New-Object Text.UTF8Encoding($false)))
}

function New-Override([string]$Image, [string]$FlagValue) {
    $api = @{ image = $Image }
    if ($FlagValue) { $api.environment = @{ API_TENDER_LATENCY_DIAGNOSTICS = $FlagValue } }
    return @{ services = @{ api = $api } }
}

function Capture-Bundle {
    Assert-Safe (-not (Test-Path -LiteralPath $BundleDirectory)) 'Bundle already exists; preserve it and review rather than overwrite.'
    $containers = Get-ProjectContainers
    $api = Get-Api $containers
    Assert-Safe ($api.State.Running -and $api.State.Health.Status -ceq 'healthy') 'Original API is not healthy.'
    Assert-Safe (@($api.Config.Env | Where-Object { $_ -clike "$script:Flag=*" }).Count -eq 0) 'Original flag is not unset; this baseline requires separate review.'
    $root = Get-Value $api.Config.Labels 'com.docker.compose.project.working_dir'
    $files = (Get-Value $api.Config.Labels 'com.docker.compose.project.config_files').Split(',')
    Assert-Safe ($files.Count -eq 2 -and (Split-Path $files[0] -Leaf) -ceq 'docker-compose.staging.yml' -and (Split-Path $files[1] -Leaf) -ceq 'docker-compose.laptop.yml') 'Unexpected Compose file sequence.'
    $bundleFull = [IO.Path]::GetFullPath($BundleDirectory)
    foreach ($repo in @($root, (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))) {
        Assert-Safe (-not $bundleFull.StartsWith(([IO.Path]::GetFullPath($repo).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) 'Bundle must be outside the repository.'
    }
    $manifest = [ordered]@{ Version = 1; Context = $script:Context; Engine = (Invoke-Docker @('info','--format','{{.ID}}')); Project = $script:Project; ApiName = $script:ApiName; Revision = $script:Revision; StagingRoot = $root; ComposeFiles = $files; EnvironmentFile = (Join-Path $root '.env.staging'); OriginalId = $api.Id; OriginalImage = $api.Image; CapturedAt = [DateTime]::UtcNow.ToString('o') }
    $config = Read-DockerJson ((Get-ComposeArguments $manifest '') + @('config','--format','json'))
    $image = @(Read-DockerJson @('image','inspect',$api.Image))[0]
    Assert-ComposeBaseline $config $api $image
    Assert-Safe (@($image.Config.Env | Where-Object { $_ -match '^(?i:.*(?:PASSWORD|TOKEN|SECRET|API_KEY)|DATABASE_URL|REDIS_URL)=' }).Count -eq 0) 'Image has sensitive environment settings; do not archive without private review.'
    $manifest.ApiPolicy = Get-ContainerPolicy $api
    $manifest.ImagePolicy = Get-ImagePolicy $image
    $manifest.ComposePolicy = Get-ComposePolicy $config
    $manifest.ProtectedServices = Get-ProtectedServices $containers
    $hashes = @{}
    foreach ($file in @($files) + @($manifest.EnvironmentFile)) { $hashes[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
    $manifest.InputHashes = $hashes
    New-Item -ItemType Directory -Path $bundleFull | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($identity in @($sid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $bundleFull -AclObject $acl
    Assert-RestrictedDirectory $bundleFull
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $bundleFull 'Operator.ps1')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'verify-image-archive.py') -Destination (Join-Path $bundleFull 'verify-image-archive.py')
    $manifest.ArchiveVerifierHash = (Get-FileHash -LiteralPath (Join-Path $bundleFull 'verify-image-archive.py')).Hash
    $manifest.ScriptHash = (Get-FileHash -LiteralPath (Join-Path $bundleFull 'Operator.ps1') -Algorithm SHA256).Hash
    $launcher = @'
param([switch]$Approved)
if (-not $Approved) { throw 'Explicit rollback approval is required.' }
& (Join-Path $PSScriptRoot 'Operator.ps1') -Action Rollback -BundleDirectory $PSScriptRoot -Approved
exit $LASTEXITCODE
'@
    [IO.File]::WriteAllText((Join-Path $bundleFull 'Rollback.ps1'), $launcher, (New-Object Text.UTF8Encoding($false)))
    $manifest.RollbackScriptHash = (Get-FileHash -LiteralPath (Join-Path $bundleFull 'Rollback.ps1') -Algorithm SHA256).Hash
    Write-JsonFile (Join-Path $bundleFull 'rollback.yml') (New-Override $api.Image '')
    Write-JsonFile (Join-Path $bundleFull 'baseline.json') $manifest
    Write-Output 'CAPTURE PASS: restricted non-secret bundle saved; no Docker resource was changed. Image archive and candidate validation are still pending.'
}

function Read-Bundle {
    Assert-RestrictedDirectory $BundleDirectory
    $m = Get-Content -LiteralPath (Join-Path $BundleDirectory 'baseline.json') -Raw | ConvertFrom-Json
    Assert-Safe ($m.Version -eq 1 -and $m.Context -ceq $script:Context -and $m.Project -ceq $script:Project -and $m.ApiName -ceq $script:ApiName -and $m.Revision -ceq $script:Revision) 'Manifest identity mismatch.'
    Assert-Safe ((Get-FileHash -LiteralPath (Join-Path $BundleDirectory 'Operator.ps1')).Hash -ceq $m.ScriptHash) 'Operator script integrity mismatch.'
    Assert-Safe ((Get-FileHash -LiteralPath (Join-Path $BundleDirectory 'Rollback.ps1')).Hash -ceq $m.RollbackScriptHash) 'Rollback launcher integrity mismatch.'
    Assert-Safe ((Get-FileHash -LiteralPath (Join-Path $BundleDirectory 'verify-image-archive.py')).Hash -ceq $m.ArchiveVerifierHash) 'Archive verifier integrity mismatch.'
    Assert-Safe ((Invoke-Docker @('info','--format','{{.ID}}')) -ceq $m.Engine) 'Docker engine changed; do not operate on another engine.'
    foreach ($p in $m.InputHashes.PSObject.Properties) { Assert-Safe ((Get-FileHash -LiteralPath $p.Name).Hash -ceq $p.Value) 'Original Compose or environment file changed; private review required.' }
    $containers = Get-ProjectContainers
    Assert-Safe ((Get-ProtectedServices $containers) -ceq $m.ProtectedServices) 'Worker, Redis or ClamAV identity/configuration changed; stop.'
    return $m
}

function Read-PreservedImage($Manifest) {
    $p = Get-Content -LiteralPath (Join-Path $BundleDirectory 'preservation.json') -Raw | ConvertFrom-Json
    Assert-Safe ($p.Image -ceq $Manifest.OriginalImage -and (Get-FileHash -LiteralPath (Join-Path $BundleDirectory 'original-image.tar')).Hash -ceq $p.ArchiveHash) 'Original image archive is missing or corrupt.'
    Assert-Archive (Join-Path $BundleDirectory 'original-image.tar') $Manifest.OriginalImage
    return $p
}

function Assert-Archive([string]$Path, [string]$ImageId) {
    $python = (Get-Command python -CommandType Application -ErrorAction Stop).Source
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $captured = & $python -I -B (Join-Path $BundleDirectory 'verify-image-archive.py') $Path $ImageId 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    Assert-Safe ($code -eq 0) 'Archive structural/content validation failed or Python 3.9+ is unavailable; raw output suppressed.'
}

function Assert-CandidateInstrumentation([string]$ImageId) {
    # Immutable image, no API import/start, no mounts/env/ports and no network.
    $probe = @'
const fs = require('node:fs');
try {
  const module = fs.readFileSync('/app/dist/common/tender-detail-timing.js', 'utf8');
  const main = fs.readFileSync('/app/dist/main.js', 'utf8');
  if (!/export\s+function\s+beginTenderDetailTiming\s*\(/.test(module) ||
      !/import\s*\{[^}]*\bbeginTenderDetailTiming\b[^}]*\}\s*from\s*['\x22]\.\/common\/tender-detail-timing\.js['\x22]/s.test(main) ||
      !/fastify\.addHook\(['\x22]onRequest['\x22]/.test(main) ||
      !/beginTenderDetailTiming\s*\(\s*request\s*,\s*environment\.API_TENDER_LATENCY_DIAGNOSTICS\s*,\s*startedAt\s*,?\s*\)/.test(main)) process.exit(1);
} catch { process.exit(1); }
'@
    $null = Invoke-Docker @('run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','node','--pids-limit','32','--memory','128m','--cpus','0.25','--entrypoint','node',$ImageId,'-e',$probe)
}

function Assert-PlannedConfig($Manifest, [string]$File, [string]$ImageId, [string]$FlagValue = '') {
    $config = Read-DockerJson ((Get-ComposeArguments $Manifest $File) + @('config','--format','json'))
    Assert-Safe ($config.name -ceq $script:Project -and $config.services.api.image -ceq $ImageId -and (Get-ComposePolicy $config) -ceq $Manifest.ComposePolicy) 'Unexpected resolved Compose changes; values suppressed.'
    $actualFlag = Get-Value $config.services.api.environment $script:Flag
    Assert-Safe ($(if ($FlagValue) { $actualFlag -ceq $FlagValue } else { $null -eq $actualFlag })) 'Planned diagnostic mode mismatch.'
}

function Stage-Candidate($Manifest) {
    Assert-Safe $Approved 'Explicit approval is required to archive and stage images.'
    Assert-Safe ($CandidateImage -and -not (Test-Path (Join-Path $BundleDirectory 'candidate.json'))) 'Candidate required; existing staged candidate must not be overwritten.'
    $api = Get-Api (Get-ProjectContainers)
    Assert-Safe ($api.Id -ceq $Manifest.OriginalId -and $api.Image -ceq $Manifest.OriginalImage -and (Get-ContainerPolicy $api) -ceq $Manifest.ApiPolicy) 'Original API changed since capture.'
    $candidate = @(Read-DockerJson @('image','inspect',$CandidateImage))[0]
    Assert-Safe ((Get-Value $candidate.Config.Labels 'org.opencontainers.image.revision') -ceq $Manifest.Revision) 'Candidate revision label mismatch.'
    Assert-Safe ($candidate.Os -ceq 'linux' -and $candidate.Architecture -ceq 'amd64' -and (Get-ImagePolicy $candidate) -ceq $Manifest.ImagePolicy) 'Candidate command/user/runtime image policy differs.'
    $baseConfig = Read-DockerJson ((Get-ComposeArguments $Manifest '') + @('config','--format','json'))
    Assert-Environment $baseConfig.services.api $candidate $api
    Assert-CandidateInstrumentation $candidate.Id
    Write-JsonFile (Join-Path $BundleDirectory 'enabled.yml') (New-Override $candidate.Id 'true')
    Write-JsonFile (Join-Path $BundleDirectory 'disabled.yml') (New-Override $candidate.Id 'false')
    Assert-PlannedConfig $Manifest (Join-Path $BundleDirectory 'enabled.yml') $candidate.Id 'true'
    Assert-PlannedConfig $Manifest (Join-Path $BundleDirectory 'disabled.yml') $candidate.Id 'false'
    Assert-PlannedConfig $Manifest (Join-Path $BundleDirectory 'rollback.yml') $Manifest.OriginalImage
    $archive = Join-Path $BundleDirectory 'original-image.tar'
    Assert-Safe (-not (Test-Path -LiteralPath $archive)) 'Archive already exists; do not overwrite preserved evidence.'
    $null = Invoke-Docker @('image','inspect',$Manifest.OriginalImage)
    $null = Invoke-Docker @('image','save','--output',$archive,$Manifest.OriginalImage)
    Assert-Archive $archive $Manifest.OriginalImage
    Write-JsonFile (Join-Path $BundleDirectory 'preservation.json') @{ Image = $Manifest.OriginalImage; ArchiveHash = (Get-FileHash -LiteralPath $archive).Hash; LoadRecovery = 'UNVERIFIED' }
    Write-JsonFile (Join-Path $BundleDirectory 'candidate.json') @{ Image = $candidate.Id; Revision = $Manifest.Revision }
    Write-Output 'STAGE PASS: isolated candidate inspection passed and original archive validated. No staging service changed. Load recovery remains UNVERIFIED.'
}

function Assert-Ready($Manifest, [string]$ImageId, [string]$FlagValue) {
    $api = Get-Api (Get-ProjectContainers)
    Assert-Loopback $api
    Assert-Safe ($api.Image -ceq $ImageId -and (Get-ContainerPolicy $api) -ceq $Manifest.ApiPolicy -and $api.State.Running -and $api.State.Health.Status -ceq 'healthy') 'API postcondition failed.'
    $expected = if ($FlagValue) { @("$script:Flag=$FlagValue") } else { @() }
    Assert-Safe ((Get-Fingerprint @($api.Config.Env | Where-Object { $_ -clike "$script:Flag=*" })) -ceq (Get-Fingerprint $expected)) 'Diagnostic environment does not match selected mode.'
    $probe = "fetch('http://127.0.0.1:4000/ready',{redirect:'error',signal:AbortSignal.timeout(10000)}).then(async r=>{if(r.status!==200)process.exitCode=1;await r.body?.cancel()}).catch(()=>{process.exitCode=1})"
    $null = Invoke-Docker @('exec',$script:ApiName,'node','-e',$probe)
    # Inspect only the actual API Node process, not PID 1 (tini) or this probe.
    $processProbe = @'
const fs = require('node:fs');
const expected = process.argv[1];
let matches = 0;
for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
  if (fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== 'node') continue;
  const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
  if (!args.some(x => /(^|\/)dist\/main\.js$/.test(x))) continue;
  matches++;
  const flags = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(x => x.startsWith('API_TENDER_LATENCY_DIAGNOSTICS='));
  if (JSON.stringify(flags) !== JSON.stringify(expected === 'unset' ? [] : ['API_TENDER_LATENCY_DIAGNOSTICS=' + expected])) process.exit(1);
}
if (matches !== 1) process.exit(1);
if (expected !== 'unset' && (!fs.existsSync('/app/dist/common/tender-detail-timing.js') || !fs.readFileSync('/app/dist/main.js', 'utf8').includes('beginTenderDetailTiming'))) process.exit(1);
'@
    $mode = if ($FlagValue) { $FlagValue } else { 'unset' }
    $null = Invoke-Docker @('exec',$script:ApiName,'node','-e',$processProbe,$mode)
    return $api
}

function Restore-Api($Manifest) {
    $null = Read-PreservedImage $Manifest
    $current = Get-Api (Get-ProjectContainers) -AllowAbsent
    $candidateFile = Join-Path $BundleDirectory 'candidate.json'
    $candidateId = if (Test-Path $candidateFile) { (Get-Content $candidateFile -Raw | ConvertFrom-Json).Image } else { $Manifest.OriginalImage }
    Assert-Safe ($null -eq $current -or @($Manifest.OriginalImage, $candidateId) -ccontains $current.Image) 'Rollback refuses an unrelated API replacement.'
    Assert-PlannedConfig $Manifest (Join-Path $BundleDirectory 'rollback.yml') $Manifest.OriginalImage
    # Loading the verified archive also works after an image-cache loss/reboot; it never starts containers.
    $null = Invoke-Docker @('image','load','--input',(Join-Path $BundleDirectory 'original-image.tar'))
    $null = Invoke-Docker @('image','inspect',$Manifest.OriginalImage)
    $protected = Get-ProtectedServices (Get-ProjectContainers) -IncludeStartTime
    $null = Invoke-Docker ((Get-ComposeArguments $Manifest (Join-Path $BundleDirectory 'rollback.yml')) + @('up','-d','--no-build','--pull','never','--no-deps','--wait','--wait-timeout','120','api'))
    $null = Assert-Ready $Manifest $Manifest.OriginalImage ''
    Assert-Safe ((Get-ProtectedServices (Get-ProjectContainers) -IncludeStartTime) -ceq $protected) 'Protected services changed during rollback; investigate without changing them.'
    Write-Output 'ROLLBACK PASS: original API image/configuration restored and ready; protected services unchanged. Browser authentication still needs operator verification.'
}

function Change-Api($Manifest, [string]$Mode) {
    Assert-Safe $Approved 'Explicit API recreation approval is required.'
    Assert-Safe $AcknowledgeUnrehearsedRecovery 'Load recovery has not been rehearsed. Explicit acknowledgement is required before API recreation.'
    $null = Read-PreservedImage $Manifest
    $candidate = Get-Content -LiteralPath (Join-Path $BundleDirectory 'candidate.json') -Raw | ConvertFrom-Json
    $image = @(Read-DockerJson @('image','inspect',$candidate.Image))[0]
    Assert-Safe ($candidate.Revision -ceq $Manifest.Revision -and (Get-Value $image.Config.Labels 'org.opencontainers.image.revision') -ceq $Manifest.Revision -and (Get-ImagePolicy $image) -ceq $Manifest.ImagePolicy) 'Candidate integrity/revision mismatch.'
    $api = Get-Api (Get-ProjectContainers)
    Assert-Safe ((Get-ContainerPolicy $api) -ceq $Manifest.ApiPolicy) 'API settings drifted; no recreation permitted.'
    if ($Mode -ceq 'Enable') { Assert-Safe ($api.Id -ceq $Manifest.OriginalId -and $api.Image -ceq $Manifest.OriginalImage) 'Enable requires the original captured API.' }
    else { Assert-Safe ($api.Image -ceq $candidate.Image) 'Disable requires the approved candidate.' }
    $flagValue = if ($Mode -ceq 'Enable') { 'true' } else { 'false' }
    $file = Join-Path $BundleDirectory $(if ($Mode -ceq 'Enable') { 'enabled.yml' } else { 'disabled.yml' })
    Assert-PlannedConfig $Manifest $file $candidate.Image $flagValue
    $protected = Get-ProtectedServices (Get-ProjectContainers) -IncludeStartTime
    try {
        $null = Invoke-Docker ((Get-ComposeArguments $Manifest $file) + @('up','-d','--no-build','--pull','never','--no-deps','--wait','--wait-timeout','120','api'))
        $null = Assert-Ready $Manifest $candidate.Image $flagValue
        Assert-Safe ((Get-ProtectedServices (Get-ProjectContainers) -IncludeStartTime) -ceq $protected) 'Protected services changed during API operation.'
    } catch {
        Write-Output 'API operation failed; attempting original-image rollback. No workload is permitted.'
        Restore-Api (Read-Bundle)
        Assert-Safe $false 'Candidate operation failed and original API was restored.'
    }
    Write-Output "$Mode PASS: API ready. Before workload, authenticated browser and correlation gates are mandatory."
}

function Assert-Correlation($Records, [string]$Id, [string]$ResponseId, [int]$Status) {
    $parsed = [guid]::Empty
    Assert-Safe ([guid]::TryParse($Id, [ref]$parsed) -and $Id -ceq $ResponseId -and $Status -eq 200) 'Authenticated browser response/ID gate failed.'
    $matches = @($Records | Where-Object { (Get-Value $_ 'event') -ceq 'tender_detail_stage_timing' -and (Get-Value $_ 'request_id') -ceq $Id })
    Assert-Safe ($matches.Count -eq 1) 'Expected exactly one correlated diagnostic record.'
    $r = $matches[0]
    Assert-Safe ($r.status_code -eq 200 -and $r.method -ceq 'GET' -and $r.route -ceq '/organisations/:organisationId/tenders/:tenderId') 'Unexpected correlated route/status.'
    foreach ($stage in @('session_authentication','organisation_authorization','tender_primary_query','response_mapping','post_handler_pre_send','send_to_response','unattributed')) {
        $v = Get-Value $r.stages_ms $stage
        Assert-Safe ($null -ne $v -and $v -is [ValueType] -and -not [double]::IsNaN([double]$v) -and -not [double]::IsInfinity([double]$v) -and [double]$v -ge 0) 'Missing/invalid diagnostic stage.'
    }
}

if ($LibraryOnly) { return }
try {
    if ($Action -ceq 'Capture') { Capture-Bundle; exit 0 }
    $manifest = Read-Bundle
    switch ($Action) {
        'Stage' { Stage-Candidate $manifest }
        'Preflight' {
            $api = Get-Api (Get-ProjectContainers)
            Assert-Safe ($api.Image -ceq $manifest.OriginalImage -and (Get-ContainerPolicy $api) -ceq $manifest.ApiPolicy) 'Captured API changed.'
            Assert-PlannedConfig $manifest (Join-Path $BundleDirectory 'rollback.yml') $manifest.OriginalImage
            Write-Output 'PREFLIGHT PASS: captured identity/configuration match. This is not candidate or deployment validation.'
        }
        'Enable' { Change-Api $manifest 'Enable' }
        'Disable' { Change-Api $manifest 'Disable' }
        'Rollback' { Assert-Safe $Approved 'Explicit rollback approval required.'; Restore-Api $manifest }
        'Correlate' {
            Assert-Safe $Approved 'Approval for the authenticated gate and rollback on failure is required.'
            try {
                $candidate = Get-Content (Join-Path $BundleDirectory 'candidate.json') -Raw | ConvertFrom-Json
                $api = Assert-Ready $manifest $candidate.Image 'true'
                $lines = (Invoke-Docker @('logs','--since','5m','--tail','1000',$script:ApiName)) -split "`n"
                $records = foreach ($line in $lines) { try { ConvertFrom-Json $line } catch { } }
                Assert-Correlation $records $RequestId $ResponseRequestId $BrowserStatus
                Write-Output 'CORRELATION PASS: approved authenticated GET and private timing record match. Bounded workload may proceed within five minutes on this unchanged API.'
            } catch {
                Write-Output 'Authentication/correlation gate failed; no workload permitted. Attempting rollback.'
                Restore-Api (Read-Bundle)
                Assert-Safe $false 'Gate failed and original API was restored.'
            }
        }
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($script:SafeFailure)
    [Console]::Error.WriteLine('STOP. No workload is permitted. If an API change was attempted, use the persistent Rollback.ps1 after resolving its preflight; never change other services to force success.')
    exit 1
}
