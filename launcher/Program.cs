using System.Diagnostics;

var baseDir = AppContext.BaseDirectory;
var nodePath = Path.Combine(baseDir, "node.exe");
if (!File.Exists(nodePath))
{
    nodePath = "node";
}

var entryPath = Path.Combine(baseDir, "app", "cli.cjs");
if (!File.Exists(entryPath))
{
    Console.Error.WriteLine($"Missing bundled app entry: {entryPath}");
    return 2;
}

var forwardedArgs = args.Length == 0 ? new[] { "web" } : args;
var startInfo = new ProcessStartInfo
{
    FileName = nodePath,
    WorkingDirectory = Environment.CurrentDirectory,
    UseShellExecute = false
};
startInfo.Environment["SKILLS_MIGRATOR_APP_DIR"] = Path.Combine(baseDir, "app");

startInfo.ArgumentList.Add(entryPath);
foreach (var arg in forwardedArgs)
{
    startInfo.ArgumentList.Add(arg);
}

using var process = Process.Start(startInfo);
if (process is null)
{
    Console.Error.WriteLine("Failed to start bundled Node runtime.");
    return 3;
}

process.WaitForExit();
return process.ExitCode;
