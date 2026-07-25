# Ajouter une présentation de tool call

Ce guide couvre l'ajout d'une présentation visuelle pour un outil RPC dans la conversation.
Chaque étape est obligatoire sauf mention contraire. La présentation `bash` dans
[`tool-calls.ts`](../src/features/conversation/tool-calls.ts) sert de référence minimale :
ouvre ce fichier et repère `bashPresentation` pour suivre sa structure.

## 1. Créer la fonction de présentation

Ajoute une fonction dans `src/features/conversation/tool-calls.ts`.

**Signature :** `(args: unknown, repositoryRoot?: string | null) => ToolCallPresentation`

**Contrat :**
- `args` est `unknown` — toujours valider avant d'accéder aux champs. Utilise `isObject()` pour
  vérifier que `args` est un objet JSON.
- Retourne `{}` si les arguments sont invalides (fallback silencieux, aucun affichage).
- `headerDetail.text` : version courte affichée dans l'en-tête (limiter à ~80 caractères via
  `truncateToolText`).
- `headerDetail.title` : version complète pour le tooltip et le lecteur d'écran.
- `headerDetail.suffix` : optionnel, ajouté après le texte (ex: plage de lignes `[1:10]`).
- `pendingDetail` : optionnel, affiché sous le statut « In progress… ».
- `repositoryRoot` permet de rendre les chemins absolus relatifs au dépôt via
  `pathFromRepositoryRoot`.

```ts
// src/features/conversation/tool-calls.ts

function monOutilPresentation(args: unknown): ToolCallPresentation {
  if (!isObject(args) || typeof args.monChamp !== 'string') return {}

  const champ = args.monChamp

  return {
    headerDetail: { text: truncateToolText(champ, 80).text, title: champ },
    pendingDetail: 'En attente…',
  }
}
```

Le corps de la fonction est libre : extrais les champs utiles, transforme-les si besoin,
retourne la présentation. Inspire-toi de `bashPresentation` pour le cas simple, de
`filePresentation` pour les chemins relatifs, ou de `readPresentation` pour un enrichissement
d'une autre présentation.

## 2. Enregistrer la présentation

Ajoute une entrée dans l'objet `toolCallPresentations` avec le **nom exact de l'outil RPC**
comme clé (tel qu'envoyé par Pi dans les événements RPC : `bash`, `read`, `write`, `edit`,
`grep`, `find`, etc.) :

```ts
const toolCallPresentations: Record<string, ToolCallPresenter> = {
  // … existants …
  mon_outil: monOutilPresentation,
}
```

## 3. Ajouter un test

Dans `test/tool-calls.test.ts`, teste via `toolCallPresentation()` (la fonction publique qui
résout le nom d'outil → présentation). Couvre deux cas :

- **Arguments valides :** vérifie que `headerDetail.text` et `.title` correspondent aux données
- **Arguments invalides :** teste `{}`, `null`, ou un champ absent → `{}`

```ts
test('monOutilPresentation affiche le champ principal', () => {
  const presentation = toolCallPresentation({
    name: 'mon_outil', id: 'call_1', args: { monChamp: 'valeur' },
  })
  assert.equal(presentation.headerDetail?.text, 'valeur')
  assert.equal(presentation.headerDetail?.title, 'valeur')
})

test('monOutilPresentation ignore les arguments invalides', () => {
  assert.deepEqual(
    toolCallPresentation({ name: 'mon_outil', id: 'call_1', args: {} }),
    {},
  )
  assert.deepEqual(
    toolCallPresentation({ name: 'mon_outil', id: 'call_1', args: null }),
    {},
  )
})
```

## Utilitaires disponibles

| Fonction | Usage |
|---|---|
| `truncateToolText(text, maxLength)` | Tronque avec `…` et retourne `{ text, truncated }` |
| `pathFromRepositoryRoot(path, root)` | Rend un chemin absolu relatif à la racine du dépôt |
| `toolFilePath(args)` | Extrait `args.path` si présent et valide |
| `isObject(value)` | Type guard `value is JsonObject` |

## Récapitulatif des fichiers touchés

| Fichier | Action |
|---|---|
| `src/features/conversation/tool-calls.ts` | Fonction de présentation + entrée dans `toolCallPresentations` |
| `test/tool-calls.test.ts` | Test de la présentation et du fallback |

## Présentations de référence

Toutes dans [`tool-calls.ts`](../src/features/conversation/tool-calls.ts) :

- `bashPresentation` — la plus simple : un champ texte + `pendingDetail`
- `filePresentation` — chemin relatif au dépôt via `pathFromRepositoryRoot`
- `readPresentation` — enrichit `filePresentation` avec un suffixe (plage de lignes)
