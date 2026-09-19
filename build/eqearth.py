"""Equal Earth projection: forward + inverse, vectorised numpy."""
import numpy as np

A1, A2, A3, A4 = 1.340264, -0.081106, 0.000893, 0.003796
M = np.sqrt(3.0) / 2.0


def _fy(th):
    th2 = th * th
    th6 = th2 ** 3
    return th * (A1 + A2 * th2 + th6 * (A3 + A4 * th2))


def _fyp(th):
    th2 = th * th
    th6 = th2 ** 3
    return A1 + 3 * A2 * th2 + th6 * (7 * A3 + 9 * A4 * th2)


def forward(lon_deg, lat_deg):
    lam = np.radians(lon_deg)
    phi = np.radians(lat_deg)
    th = np.arcsin(M * np.sin(phi))
    x = lam * np.cos(th) / (M * _fyp(th))
    y = _fy(th)
    return x, y


def bounds():
    xmax = np.pi / (M * A1)
    ymax = float(_fy(np.arcsin(M)))
    return float(xmax), ymax


def inverse(x, y, iters=8):
    """Returns lon_deg, lat_deg, valid_mask."""
    th = np.arcsin(np.clip(y / bounds()[1], -1, 1) * M)  # decent seed
    th = th.astype(np.float64)
    for _ in range(iters):
        th = th - (_fy(th) - y) / _fyp(th)
    s = np.sin(th) / M
    valid = np.abs(s) <= 1.0
    s = np.clip(s, -1, 1)
    phi = np.arcsin(s)
    lam = M * x * _fyp(th) / np.cos(th)
    valid &= np.abs(lam) <= np.pi + 1e-9
    return np.degrees(lam), np.degrees(phi), valid
