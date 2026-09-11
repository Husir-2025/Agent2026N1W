param(
  [string]$BundlePath = (Join-Path $PSScriptRoot '写文助手项目构建与代码索引.txt'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'writing-agent-restored')
)

$ErrorActionPreference = 'Stop'
$bundle = [System.IO.Path]::GetFullPath($BundlePath)
$output = [System.IO.Path]::GetFullPath($OutputPath)

if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) {
  throw "找不到源码归档：$bundle"
}

if (Test-Path -LiteralPath $output) {
  $existing = @(Get-ChildItem -LiteralPath $output -Force)
  if ($existing.Count -gt 0) {
    throw "输出目录不是空目录，已停止以避免覆盖：$output"
  }
} else {
  New-Item -ItemType Directory -Path $output | Out-Null
}

$text = [System.IO.File]::ReadAllText($bundle, [System.Text.Encoding]::UTF8)
$pattern = '(?ms)^===== FILE BEGIN =====\nPATH: (?<path>[^\n]+)\nSIZE: (?<size>\d+)\nSHA256: (?<hash>[0-9a-f]{64})\nFINAL_NEWLINE: (?<finalNewline>yes|no)\n----- CONTENT BEGIN -----\n(?<content>.*?)----- CONTENT END -----\n===== FILE END =====$'
$matches = [System.Text.RegularExpressions.Regex]::Matches($text, $pattern)

if ($matches.Count -eq 0) {
  throw '归档中没有找到源码文件块。请确认使用的是包含“完整源码归档”的新版 TXT。'
}

$rootPrefix = $output.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$utf8 = [System.Text.UTF8Encoding]::new($false)

foreach ($match in $matches) {
  $relative = $match.Groups['path'].Value.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $target = [System.IO.Path]::GetFullPath((Join-Path $output $relative))
  if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "归档包含不安全路径：$relative"
  }

  $directory = [System.IO.Path]::GetDirectoryName($target)
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $content = $match.Groups['content'].Value
  if ($match.Groups['finalNewline'].Value -eq 'no' -and $content.EndsWith("`n")) {
    $content = $content.Substring(0, $content.Length - 1)
  }
  [System.IO.File]::WriteAllText($target, $content, $utf8)
  $actualHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  $expectedHash = $match.Groups['hash'].Value
  if ($actualHash -ne $expectedHash) {
    throw "校验失败：$relative"
  }
}

Write-Host "已还原 $($matches.Count) 个源码文件到：$output"
Write-Host '下一步：进入该目录，运行 pnpm install --frozen-lockfile，然后运行 pnpm test 和 pnpm build。'
