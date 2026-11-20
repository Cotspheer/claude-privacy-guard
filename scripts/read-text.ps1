# Prints the text of an image or a PDF, read with the text recognition that is built into Windows.
# Everything runs on this computer; no service is called. A PDF is rendered page by page and each page is read
# like an image, so scanned PDFs work too.
param([Parameter(Mandatory = $true)][string]$Path, [int]$MaxPages = 10)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asTaskOf = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTask = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Wait-Result($operation, [Type]$type) {
    $task = $asTaskOf.MakeGenericMethod($type).Invoke($null, @($operation))
    $task.Wait() | Out-Null
    $task.Result
}
function Wait-Done($action) { $asTask.Invoke($null, @($action)).Wait() | Out-Null }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { [Console]::Error.WriteLine('No text recognition language is installed in Windows.'); exit 3 }

function Read-Stream($stream) {
    $decoder = Wait-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Wait-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Wait-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
}

$file = Wait-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $Path).Path)) ([Windows.Storage.StorageFile])
if ($file.FileType -eq '.pdf') {
    $document = Wait-Result ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    $pages = [Math]::Min($document.PageCount, $MaxPages)
    for ($i = 0; $i -lt $pages; $i++) {
        $page = $document.GetPage($i)
        # Twice the page's size: small print is read more reliably.
        $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
        $options.DestinationWidth = [uint32]([Math]::Min($page.Size.Width * 2, 4000))
        $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
        Wait-Done ($page.RenderToStreamAsync($stream, $options))
        Read-Stream $stream
        $page.Dispose()
    }
    if ($document.PageCount -gt $pages) { "[pages $($pages + 1) to $($document.PageCount) were not read]" }
} else {
    $stream = Wait-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    Read-Stream $stream
}
