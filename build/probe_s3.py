# =========================================================================
#  LE SONDAGE
#
#      pip install omfiles fsspec s3fs
#      python build/probe_s3.py
#
#  Open-Meteo publie ses champs bruts sur AWS Open Data : accès anonyme,
#  sans clé, SANS QUOTA. Ce sont les mêmes données que l'API qui nous
#  compte un appel par coordonnée — mais livrées en grilles complètes au
#  lieu de points comptés un par un.
#
#  Si ça marche, la maille de 3° tombe : on lirait ECMWF IFS à 0,25° ou
#  GFS à 13 km, et l'on agrégerait soi-même. Mieux encore, on pourrait
#  prendre le MAXIMUM de la pluie sur les seize cellules d'un degré plutôt
#  qu'un unique point au hasard — ce qui est exactement la dilatation
#  qu'on cherche, et gratuitement.
#
#  CE SCRIPT NE FABRIQUE RIEN. Il regarde ce qu'il y a, et il le dit. Un
#  chantier de cette taille ne se lance pas sur une supposition.
# =========================================================================

import sys
from datetime import datetime, timedelta, timezone

try:
    import fsspec
    from omfiles import OmFileReader
except ImportError as e:
    sys.exit(f"manque une bibliothèque ({e}).\n"
             f"    pip install omfiles fsspec s3fs")

BUCKET = "openmeteo"

# Les deux modèles globaux. On essaie le meilleur d'abord.
MODELS = ["ecmwf_ifs025", "ncep_gfs013", "ncep_gfs025"]

# Ce qu'il nous faut : de l'eau qui tombe, et du soleil qui arrive.
WANTED = ["precipitation", "direct_radiation", "shortwave_radiation",
          "cloud_cover", "cloud_cover_low", "temperature_2m"]


def s3():
    return fsspec.filesystem("s3", anon=True)


def look_around(fs):
    """Quels modèles sont là, et à quelles dates."""
    print("=" * 62)
    print("CE QUE CONTIENT LE DÉPÔT")
    print("=" * 62)
    try:
        tops = fs.ls(f"{BUCKET}/data_spatial/", detail=False)
    except Exception as e:
        sys.exit(f"impossible de lister le dépôt : {e}")

    names = [p.rsplit("/", 1)[-1] for p in tops if p.rsplit("/", 1)[-1]]
    print(f"\n{len(names)} modèles :")
    for n in sorted(names):
        mark = "  <--" if n in MODELS else ""
        print(f"    {n}{mark}")
    return names


def newest_file(fs, model, back_hours=48):
    """Le fichier le plus récent qu'on trouve, en remontant heure par
    heure. Les passages de modèle prennent quelques heures à arriver : le
    fichier de maintenant n'existe pas encore."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    for h in range(back_hours):
        t = now - timedelta(hours=h)
        # data_spatial/<modele>/<aaaa>/<mm>/<jj>/<HH>0000Z/
        d = (f"{BUCKET}/data_spatial/{model}/{t:%Y/%m/%d}/"
             f"{t:%H}0000Z/")
        try:
            files = fs.ls(d, detail=False)
        except Exception:
            continue
        files = [f for f in files if f.endswith(".om")]
        if files:
            return sorted(files)[0], t, len(files)
    return None, None, 0


def inspect(fs, path):
    """Les variables du fichier, et la forme de leurs champs."""
    url = f"blockcache::s3://{path}"
    backend = fsspec.open(url, mode="rb",
                          s3={"anon": True, "default_block_size": 65536},
                          blockcache={"cache_storage": "/tmp/om-cache"})
    with OmFileReader(backend) as root:
        names = []
        for i in range(root.number_of_children):
            try:
                c = root.get_child(i)
                names.append(c.name)
            except Exception:
                break
        if not names:
            # Selon la version, l'accès se fait par nom seulement.
            for w in WANTED:
                try:
                    if root.get_child_by_name(w) is not None:
                        names.append(w)
                except Exception:
                    pass

        print(f"\n{len(names)} variables :")
        for n in sorted(names):
            mark = "  <-- ce qu'il nous faut" if n in WANTED else ""
            print(f"    {n}{mark}")

        print("\nformes :")
        for w in WANTED:
            if w not in names:
                continue
            try:
                ch = root.get_child_by_name(w)
                print(f"    {w:22s} {ch.shape}  {ch.dtype}")
            except Exception as e:
                print(f"    {w:22s} illisible ({e})")

        found = [w for w in WANTED if w in names]
        print()
        print("=" * 62)
        if "precipitation" in found and any(
                r in found for r in ("direct_radiation", "shortwave_radiation")):
            print("VERDICT : la pluie ET le rayonnement sont là.")
            print("          On peut abandonner l'API par points.")
        elif "precipitation" in found:
            print("VERDICT : la pluie est là, le rayonnement non.")
            print("          La trouée devrait passer par la nébulosité.")
        else:
            print("VERDICT : il manque l'essentiel. On reste sur l'API.")
        print("=" * 62)


def main():
    fs = s3()
    have = look_around(fs)

    for model in MODELS:
        if model not in have:
            continue
        print()
        print("=" * 62)
        print(f"MODÈLE : {model}")
        print("=" * 62)
        path, when, count = newest_file(fs, model)
        if not path:
            print("  aucun fichier récent trouvé")
            continue
        print(f"  passage du {when:%Y-%m-%d %H:00} UTC, {count} fichiers")
        print(f"  {path}")
        try:
            inspect(fs, path)
        except Exception as e:
            print(f"  lecture impossible : {e}")
        return

    print("\naucun des modèles globaux attendus n'a été trouvé.")


if __name__ == "__main__":
    main()
