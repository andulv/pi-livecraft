# Ajouter une présentation de tool call

Ce guide couvre l'ajout d'une présentation visuelle pour un outil RPC dans la conversation.
Chaque étape est obligatoire sauf mention contraire. La présentation [`bash`](../src/features/conversation/tool-calls.ts#L251)
sert de référence minimale.

## 1. Créer la fonction de présentation

Ajoute une fonction dans `src/features/conversation/tool-calls.ts`.

```ts
// src/features/conversation/tool-calls.ts

function monOutilPresentation(args: unknown, repositoryRoot?: string | null): ToolCallPresentation {
  // 1. Valider les arguments sans présumer de leur forme
  if (!isObject(args) || typeof args.monChamp !== 'string') return {}

  // 2. Extraire les données
  const champ = args.monChamp

  // 3. Retourner la présentation
  return {
    headerDetail: { text: truncateToolText(champ, 80).text, title: champ },
    pendingDetail: 'En attente…',
  }
}
```

**Signature :** `(args: unknown, repositoryRoot?: string | null) => ToolCallPresentation`

**Contrat :**
- `args` est `unknown` — toujours valider avant d'accéder aux champs
- Retourner `{}` si les arguments sont invalides (fallback silencieux)
- `headerDetail.text` : version courte affichée dans l'en-tête (80 car. max via `truncateToolText`)
- `headerDetail.title` : version complète pour le tooltip et le lecteur d'écran
- `headerDetail.suffix` : optionnel, ajouté après le texte (ex: plage de lignes `[1:10]`)
- `pendingDetail` : affiché sous le statut « In progress… », optionnel
- `repositoryRoot` permet de rendre les chemins relatifs au dépôt via `pathFromRepositoryRoot`

## 2. Enregistrer la présentation

Ajoute une entrée dans l'objet `toolCallPresentations` avec le **nom exact de l'outil RPC** comme clé :

```ts
// src/features/conversation/tool-calls.ts

const toolCallPresentations: Record<string, ToolCallPresenter> = {
  // … existants …
  mon_outil: monOutilPresentation,
}
```

Le nom doit correspondre exactement à celui envoyé par Pi dans les événements RPC (ex: `bash`,
`read`, `write`, `edit`, `grep`, `find`).

## 3. Ajouter un test

Dans `test/tool-calls.test.ts`, couvrir deux cas :

```ts
// test/tool-calls.test.ts

test('monOutilPresentation affiche le champ principal', () => {
  const presentation = toolCallPresentation({ name: 'mon_outil', id: 'call_1', args: { monChamp: 'valeur' } })
  assert.equal(presentation.headerDetail?.text, 'valeur')
  assert.equal(presentation.headerDetail?.title, 'valeur')
})

test('monOutilPresentation ignore les arguments invalides', () => {
  const presentation = toolCallPresentation({ name: 'mon_outil', id: 'call_1', args: {} })
  assert.deepEqual(presentation, {})

  const missing = toolCallPresentation({ name: 'mon_outil', id: 'call_1', args: null })
  assert.deepEqual(missing, {})
})
```

`toolCallPresentation()` est la fonction publique qui résout le nom d'outil → présentation.
Tester via elle plutôt que d'appeler directement la fonction privée.

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

- [`bashPresentation`](../src/features/conversation/tool-calls.ts#L251) — la plus simple : un champ texte + optionnel
- [`readPresentation`](../src/features/conversation/tool-calls.ts#L280) — enrichit `filePresentation` avec un suffixe
- [`filePresentation`](../src/features/conversation/tool-calls.ts#L263) — chemin relatif au dépôt
