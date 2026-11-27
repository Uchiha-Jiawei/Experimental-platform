import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Windows 桌面弹出系统选择器，取消时返回空路径。手动输入路径适用于其他主机。
export async function pickFolder() {
  if (process.platform !== 'win32') return {folder:'',manual:true};
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = '选择项目文件夹'
    $dialog.ShowNewFolderButton = $true
    $owner = New-Object Windows.Forms.Form
    $owner.TopMost = $true
    try {
      if ($dialog.ShowDialog($owner) -eq [Windows.Forms.DialogResult]::OK) {
        [Console]::Write($dialog.SelectedPath)
      }
    } finally { $dialog.Dispose(); $owner.Dispose() }
  `;
  try {
    const {stdout} = await promisify(execFile)('powershell.exe',[
      '-NoProfile','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64'),
    ],{windowsHide:true,timeout:180000,encoding:'utf8'});
    return {folder:stdout.trim()};
  } catch { return {folder:'',manual:true}; }
}
