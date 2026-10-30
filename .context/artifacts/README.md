# Artefacts partagés

Ce dossier contient les documents que plusieurs agents doivent lire : plans, rapports, diagrammes et jeux de données. `index.json` décrit chaque artefact (identifiant, titre, type, empreinte SHA-256, auteur, lien source).

## Lire

```sh
npm run artifacts -- list
```

Ouvrir ensuite seulement le fichier nécessaire.

## Ajouter

Passer par la CLI : elle calcule l'empreinte et met l'index à jour.

```sh
npm run artifacts -- add --file chemin/vers/source.html --title "Titre court" --kind plan --description "Une phrase en anglais sur l'usage de l'artefact."
```

Types : `plan`, `report`, `diagram`, `dataset`, `design`, `other`. Extensions : `.html`, `.md`, `.json`, `.svg`, `.png`, `.csv`, `.txt`, `.mmd`.

## Règles

- Un artefact est une référence, pas une source de vérité. En cas de désaccord avec le code, le code prévaut.
- Ne pas modifier un fichier d'artefact sur place : le remplacer avec `--force`, pour que l'index garde la trace du changement.
- Après une modification manuelle, lancer `npm run artifacts -- check`. Une empreinte différente signifie que l'index est périmé ; lancer `npm run artifacts -- refresh --id <id>` seulement après avoir relu le changement.
- `npm run artifacts:check` fait partie de `npm run check`.
