# Prompts for API keys (input is masked) and stores each one:
#   1. as a Windows user environment variable (reusable by future projects / Claude)
#   2. in this project's .env.local
# Values are never printed. Press Enter to skip a key.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1
param(
  [string[]]$Names = @("VAANI_API_KEY", "TELEGRAM_BOT_TOKEN", "HUBSPOT_ACCESS_TOKEN", "CALCOM_API_KEY")
)

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.local"
$lines = if (Test-Path $envFile) { [System.Collections.Generic.List[string]](Get-Content $envFile) } else { [System.Collections.Generic.List[string]]::new() }

foreach ($name in $Names) {
  $secure = Read-Host -AsSecureString "$name (Enter to skip)"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $value) { Write-Host "  skipped"; continue }

  [Environment]::SetEnvironmentVariable($name, $value, "User")

  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$name=") { $idx = $i; break } }
  if ($idx -ge 0) { $lines[$idx] = "$name=$value" } else { $lines.Add("$name=$value") }
  Write-Host "  saved ($($value.Length) chars)"
}

# UTF-8 without BOM (a BOM breaks the first key for dotenv)
[IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Done. Tell Claude to continue - it will sync these to Vercel."
