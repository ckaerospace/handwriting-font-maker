"""Build the synthetic test set: 12 fonts unseen by the classifier x 2 pages (pangram, mixed)."""
import subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor
OUT = sys.argv[1] if len(sys.argv) > 1 else "/workspace/hfm_test"
os.makedirs(OUT, exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
fonts = [("Patrick Hand","patrick"),("Schoolbell","schoolbell"),("Gochi Hand","gochi"),("Shadows Into Light","shadows"),("Caveat","caveat"),("Kalam","kalam"),
         ("Dancing Script","dancing"),("Homemade Apple","apple"),("Nanum Pen","nanum"),("Covered By Your Grace","covered"),("Architects Daughter","architects"),("Handlee","handlee")]
jobs = []
for i, (fam, n) in enumerate(fonts, 1):
    jobs.append([fam, "pangram", f"{OUT}/{n}_pangram", "--seed", str(i), "--mode", "table"])
    j = [fam, "mixed", f"{OUT}/{n}_mixed", "--seed", str(i + 40), "--mode", "crop" if i % 2 == 0 else "table"]
    if i % 3 == 0: j.append("--ruled")
    jobs.append(j)
def run(j): return subprocess.run([sys.executable, f"{here}/synth_page.py"] + j, capture_output=True, text=True)
with ThreadPoolExecutor(6) as ex:
    for j, r in zip(jobs, ex.map(run, jobs)): print(r.stdout.strip() or r.stderr.strip()[-200:])
