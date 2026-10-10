// Εικονίδιο στην περιοχή ειδοποιήσεων των Windows (κάτω δεξιά) για το EXE που τρέχει χωρίς παράθυρο.
// Δεν υπάρχει native tray στο Node, οπότε ένα κρυφό PowerShell script δείχνει το εικονίδιο (NotifyIcon).
// Μενού: Άνοιγμα Dashboard, Άνοιγμα οθόνης θεατών, Έξοδος. Η Έξοδος στέλνει «QUIT» στο stdout και ο server κλείνει σωστά.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPT = String.raw`param([string]$PortFile, [int]$ParentPid, [string]$IconPng)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$script:PortFile = $PortFile
function Get-AppPort { try { (Get-Content -LiteralPath $script:PortFile -Raw).Trim() } catch { $null } }
function Open-App([string]$Path) { $p = Get-AppPort; if ($p) { Start-Process ("http://localhost:" + $p + $Path) } }

$src = New-Object System.Drawing.Bitmap($IconPng)
$bmp = New-Object System.Drawing.Bitmap($src, 32, 32)
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$ni.Text = "Klepsydra Timer"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miAdmin = $menu.Items.Add("Άνοιγμα Dashboard")
$miView = $menu.Items.Add("Άνοιγμα οθόνης θεατών (View)")
[void]$menu.Items.Add("-")
$miQuit = $menu.Items.Add("Έξοδος")
$miAdmin.add_Click({ Open-App "/admin" })
$miView.add_Click({ Open-App "/view" })
$miQuit.add_Click({
  [Console]::Out.WriteLine("QUIT"); [Console]::Out.Flush()
  $ni.Visible = $false; $ni.Dispose(); [System.Windows.Forms.Application]::Exit()
})
$ni.ContextMenuStrip = $menu
$ni.add_DoubleClick({ Open-App "/admin" })
$ni.Visible = $true

# Αν κλείσει ο server, φεύγει και το εικονίδιο.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { $ni.Visible = $false; $ni.Dispose(); [System.Windows.Forms.Application]::Exit() }
})
$timer.Start()
$ni.ShowBalloonTip(4000, "Klepsydra Timer", "Τρέχει στο παρασκήνιο. Διπλό κλικ στο εικονίδιο για το Dashboard.", [System.Windows.Forms.ToolTipIcon]::Info)
[System.Windows.Forms.Application]::Run()
`;

// onQuit: καλείται όταν ο χρήστης διαλέξει «Έξοδος». portFile: αρχείο με τον αριθμό του port (διαβάζεται όταν πατηθεί το μενού).
function startTray({ portFile, onQuit }) {
  try {
    const dir = path.join(os.tmpdir(), "klepsydra-tray");
    fs.mkdirSync(dir, { recursive: true });
    const scriptFile = path.join(dir, "tray.ps1");
    const iconFile = path.join(dir, "icon.png");
    fs.writeFileSync(scriptFile, "﻿" + SCRIPT, "utf8"); // BOM: το PowerShell 5 διαβάζει σωστά τα ελληνικά
    fs.writeFileSync(iconFile, fs.readFileSync(path.join(__dirname, "..", "public", "img", "icon-192.png")));
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
      "-File", scriptFile, "-PortFile", portFile, "-ParentPid", String(process.pid), "-IconPng", iconFile
    ], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    child.on("error", () => { /* χωρίς PowerShell δουλεύει κανονικά, απλώς χωρίς εικονίδιο */ });
    child.stdout.on("data", d => { if (String(d).includes("QUIT")) onQuit(); });
    process.on("exit", () => { try { child.kill(); } catch { /* ήδη έκλεισε */ } });
    return child;
  } catch {
    return null;
  }
}

module.exports = { startTray };
