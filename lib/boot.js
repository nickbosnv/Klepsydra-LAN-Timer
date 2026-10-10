// Κοινά εργαλεία εκκίνησης: μηνύματα σφάλματος και άνοιγμα browser, με ή χωρίς κονσόλα.
const { spawnSync, exec } = require("child_process");

// Το EXE των Windows τρέχει χωρίς παράθυρο κονσόλας: τα σφάλματα εμφανίζονται σε παράθυρο διαλόγου.
const GUI_EXE = process.platform === "win32" && !!process.pkg && !process.stdin.isTTY;

function showError(message) {
  if (!GUI_EXE) return;
  const script = "Add-Type -AssemblyName System.Windows.Forms;" +
    "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true;" +
    "[void][System.Windows.Forms.MessageBox]::Show($f, $env:KLEP_MSG, 'Klepsydra Timer', 'OK', 'Error')";
  try {
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, env: { ...process.env, KLEP_MSG: message } });
  } catch { /* χωρίς PowerShell δεν υπάρχει άλλος τρόπος εμφάνισης */ }
}

// Εμφανίζει σφάλμα· σε κονσόλα περιμένει Enter ώστε το παράθυρο να μην κλείσει αμέσως, στο EXE δείχνει διάλογο.
function fatal(message) {
  console.error("\n" + message + "\n");
  if (process.stdin.isTTY) {
    process.stdout.write("Πάτησε Enter για έξοδο…");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
  } else {
    showError(message);
    process.exit(1);
  }
}

function openUrl(url) {
  if (process.platform !== "win32" || process.env.AUTO_OPEN_BROWSER === "false") return;
  exec(`start "" "${url}"`, { windowsHide: true });
}

module.exports = { fatal, openUrl, GUI_EXE };
