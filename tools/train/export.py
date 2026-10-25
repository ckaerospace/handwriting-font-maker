import numpy as np, torch, json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
import train as T
net = T.Net(); net.load_state_dict(torch.load("/workspace/hfm_net.pt")); net.eval()
order = ["c1.weight", "c1.bias", "c2.weight", "c2.bias", "f1.weight", "f1.bias", "f2.weight", "f2.bias"]
sd = net.state_dict()
blob = np.concatenate([sd[k].numpy().astype(np.float16).ravel() for k in order])
out = "/workspace/handwriting-font-maker/public/model"
os.makedirs(out, exist_ok=True)
blob.tofile(out + "/cls.f16")
pri = json.load(open("/workspace/hfm_wprior.json"))
meta = {"chars": CHARS, "ncls": NCLS, "in": 24, "layers": {k: list(sd[k].shape) for k in order}, "wprior": pri, "bytes": int(blob.nbytes)}
json.dump(meta, open(out + "/cls.json", "w"), separators=(",", ":"))
# check fp16 accuracy on heldout
for k in order: sd[k] = sd[k].half().float()
net.load_state_dict(sd)
with torch.no_grad(): p = net(T.Xh, T.Gh).argmax(1)
print("fp16 heldout acc", (p == T.Yh).float().mean().item(), "bytes", blob.nbytes)
# dump a few reference outputs for JS parity test
idx = [0, 7, 100, 2000, 5000]
with torch.no_grad(): lg = net(T.Xh[idx], T.Gh[idx])
json.dump({"x": T.Xh[idx].reshape(len(idx), -1).tolist(), "g": T.Gh[idx].tolist(), "logits": lg.tolist()}, open("/workspace/hfm_parity.json", "w"))
