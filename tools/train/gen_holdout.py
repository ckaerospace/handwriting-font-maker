import numpy as np, sys
from multiprocessing import Pool
from gen_data import *
if __name__ == "__main__":
    fl = [(p, fam) for p, fam, st in list_fonts() if any(fam.lower() == h.lower() for h in HELD_OUT)]
    print(len(fl), "held-out font files")
    jobs = [(p, fam, True, 5000 + k, 3) for k, (p, fam) in enumerate(fl)]
    X, G, Y = [], [], []
    with Pool(8) as pool:
        for imgs, geos, ys, meta in pool.imap_unordered(worker, jobs):
            X += imgs; G += geos; Y += ys
    np.savez_compressed("/workspace/hfm_holdout.npz", X=np.array(X, np.float16), G=np.array(G, np.float16), Y=np.array(Y, np.int16))
    print(len(Y))
