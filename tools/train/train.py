import numpy as np, torch, torch.nn as nn, torch.nn.functional as F, json, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from common import *
torch.set_num_threads(8); torch.manual_seed(0)
d = np.load("/workspace/hfm_train.npz"); X = torch.tensor(d["X"].astype(np.float32)).unsqueeze(1); G = torch.tensor(d["G"].astype(np.float32)); Y = torch.tensor(d["Y"].astype(np.int64))
h = np.load("/workspace/hfm_holdout.npz"); Xh = torch.tensor(h["X"].astype(np.float32)).unsqueeze(1); Gh = torch.tensor(h["G"].astype(np.float32)); Yh = torch.tensor(h["Y"].astype(np.int64))
class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.c1 = nn.Conv2d(1, 12, 3, padding=1); s.c2 = nn.Conv2d(12, 24, 3, padding=1)
        s.f1 = nn.Linear(24 * 36 + 5, 128); s.f2 = nn.Linear(128, NCLS); s.dp = nn.Dropout(0.3)
    def forward(s, x, g):
        x = F.max_pool2d(F.relu(s.c1(x)), 2); x = F.max_pool2d(F.relu(s.c2(x)), 2)
        x = torch.cat([x.flatten(1), g], 1)
        return s.f2(s.dp(F.relu(s.f1(x))))
if __name__ == "__main__":
    net = Net(); print(sum(p.numel() for p in net.parameters()), "params")
    EP = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    n = len(Y); bs = 512; steps = EP * (n // bs); sched = torch.optim.lr_scheduler.OneCycleLR(opt, 4e-3, total_steps=steps)
    def ev(Xe, Ge, Ye):
        net.eval(); c = 0
        with torch.no_grad():
            for i in range(0, len(Ye), 4096):
                p = net(Xe[i:i+4096], Ge[i:i+4096]).argmax(1); c += (p == Ye[i:i+4096]).sum().item()
        net.train(); return c / len(Ye)
    t0 = time.time()
    for ep in range(EP):
        perm = torch.randperm(n)
        for i in range(n // bs):
            idx = perm[i*bs:(i+1)*bs]; x = X[idx]; g = G[idx]; y = Y[idx]
            sh = np.random.randint(-1, 2, 2); x = torch.roll(x, (int(sh[0]), int(sh[1])), (2, 3))
            g = g + torch.randn_like(g) * 0.015
            loss = F.cross_entropy(net(x, g), y, label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        print(ep, round(loss.item(), 3), "train-fonts", round(ev(X[-20000:], G[-20000:], Y[-20000:]), 4), "HELDOUT", round(ev(Xh, Gh, Yh), 4), int(time.time() - t0), "s", flush=True)
    torch.save(net.state_dict(), "/workspace/hfm_net.pt")
    net.eval()
    with torch.no_grad(): p = net(Xh, Gh).argmax(1)
    conf = {}
    for t, q in zip(Yh.tolist(), p.tolist()):
        if t != q: conf[(t, q)] = conf.get((t, q), 0) + 1
    names = list(CHARS) + ["<junk>"]
    print("top confusions (true->pred):", [(names[a], names[b], c) for (a, b), c in sorted(conf.items(), key=lambda kv: -kv[1])[:25]])
