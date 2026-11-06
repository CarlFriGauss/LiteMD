import numpy as np
import matplotlib.pyplot as plt

def blahblah(L, ax, x_0, x_end, x_res):
  x = np.linspace(x_0, x_end, x_res)[None, :]
  k = np.arange(1, L+1)[:, None]
  f1 = np.sin(x)/x
  f2 = np.prod(1 - x**2/(k**2 * np.pi**2), axis=0)
  
  ax. plot(x.flatten(), f1.flatten(), label=r"$\frac{\sin x}{x}$")
  ax.plot(x.flatten(), f2.flatten(), label=r"$\prod_{k=1}^{L} 1 - \frac{x^2}{k^2\pi^2}$", ls="--")
  ax.grid(True, color="gray", lw=0.5, alpha=0.3)
  ax.set_xlabel("$x$")

  xticks = np.arange(x_0, x_end+0.1, np.pi)
  ticks_labels = [r"$-10\pi$", r"$-9\pi$", r"$-8\pi$", r"$-7\pi$", r"$-6\pi$", r"$-5\pi$", r"$-4\pi$", 
                  r"$-3\pi$", r"$-2\pi$", r"$-1\pi$", r"$0\pi$", r"$1\pi$", r"$2\pi$", r"$3\pi$", r"$4\pi$", 
                  r"$5\pi$", r"$6\pi$", r"$7\pi$", r"$8\pi$", r"$9\pi$", r"$10\pi$"]
  
  ax.set_xticks(xticks)  
  ax.set_xticklabels(ticks_labels)
  ax.legend()

  return ax

################################################
x_0, x_end, x_res = -10*np.pi, 10*np.pi, 10_000
################################################

fig, axs = plt.subplots(2, 2, figsize=(14, 10))
for i, L in enumerate([50, 250, 500, 5_000]):
  blahblah(L, axs.flatten()[i], x_0, x_end, x_res)

plt.tight_layout()
plt.show()
