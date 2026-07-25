# Ajouter un widget

Ce guide couvre l'ajout d'un widget dans la barre latérale droite. Chaque étape est obligatoire sauf
mention contraire. Le widget [Terminal](../src/features/terminal/TerminalWidget.tsx) (55 lignes) sert de
référence minimale.

## 1. Créer le composant

Crée un dossier `src/features/<widget>/` contenant le composant principal.

Le composant reçoit ses données via des **props** passées par `App.tsx` à travers `RightSidebar.tsx`.
Il ne communique jamais directement avec le backend : toute requête réseau transite par `src/api.ts`.

```tsx
// src/features/<widget>/<Widget>.tsx
import type { ReactNode } from 'react'

export function MonWidget({ workspacePath }: { workspacePath: string }) {
  // État local (formulaires, sélections, erreurs) uniquement.
  // Données persistantes → props depuis App.tsx.
  return <>{/* contenu */}</>
}
```

**Contraintes :**
- Le composant est affiché ou masqué via le rail, mais jamais démonté
- Toute persistence passe par `localStorage` (préfixe `pi-livecraft.`) côté frontend, ou par un module
  `server/features/<widget>/` côté backend
- Les classes CSS sont colocalisées dans `src/features/<widget>/<widget>.css`

## 2. Enregistrer le widget

Ajoute une entrée dans `rightWidgetDefinitions` :

```ts
// src/features/right-sidebar/right-sidebar.ts
export const rightWidgetDefinitions = [
  // … existants …
  { id: 'mon-widget', label: 'Mon widget' },
] as const
```

**Ce seul ajout crée automatiquement :**
- Une commande `open-widget-mon-widget` dans la palette
- Un raccourci clavier assignable dans les paramètres (Settings)

Aucune autre inscription n'est nécessaire.

## 3. Brancher dans RightSidebar.tsx

Deux insertions dans `src/features/right-sidebar/RightSidebar.tsx` :

### 3a. Le panneau (contenu)

```tsx
// src/features/right-sidebar/RightSidebar.tsx — dans la section <section className="right-sidebar-content">
{activeWidget === 'mon-widget' && <MonWidget workspacePath={workspacePath} />}
```

Si le widget nécessite des données chargées par `App.tsx`, ajoute les props correspondantes.
Exemple avec une garde conditionnelle :

```tsx
{activeWidget === 'mon-widget' && data && <MonWidget data={data} workspacePath={workspacePath} />}
```

### 3b. Le bouton du rail

```tsx
// src/features/right-sidebar/RightSidebar.tsx — dans la section <div className="right-sidebar-rail">
<Tooltip label="Mon widget">
  <button
    aria-controls={activeWidget === 'mon-widget' ? 'mon-widget-panel' : undefined}
    aria-expanded={activeWidget === 'mon-widget'}
    aria-label={activeWidget === 'mon-widget' ? 'Collapse mon widget' : 'Expand mon widget'}
    className="rail-tab"
    onClick={() => onWidgetSelect('mon-widget')}
    type="button"
  >
    <span aria-hidden="true">◆</span>
  </button>
</Tooltip>
```

Si le widget est conditionnel (n'apparaît que lorsque des données sont disponibles), englobe le
bouton dans la même garde :

```tsx
{data && <Tooltip label="Mon widget">…</Tooltip>}
```

### 3c. Le label d'accessibilité

Ajoute l'entrée dans la fonction `panelLabel` :

```tsx
function panelLabel(activeWidget: RightWidget | null): string {
  // … existants …
  return activeWidget === 'mon-widget' ? 'Mon widget' : /* fallback */
}
```

## 4. (Optionnel) Transmettre des props depuis App.tsx

Si le widget a besoin de données ou callbacks gérés par `App.tsx` :

```tsx
// src/App.tsx — dans le rendu de <RightSidebar>
<RightSidebar
  // … props existantes …
  monData={monData}
  onMonAction={(arg) => { /* … */ }}
/>
```

Puis ajouter ces props à l'interface de `RightSidebar` et les transmettre au composant.

## 5. (Optionnel) Données depuis le backend

Si le widget consomme des données du backend :

### 5a. Fonction API

```ts
// src/api.ts
export async function getMonWidgetData(cwd: string): Promise<MonDataType> {
  return request<MonDataType>(`/api/mon-widget?cwd=${encodeURIComponent(cwd)}`)
}
```

### 5b. Route backend

```ts
// server/backend.ts — dans la fonction de routage
if (url.pathname === '/api/mon-widget' && request.method === 'GET') {
  const cwd = decodeURIComponent(params.get('cwd') ?? '')
  if (!cwd) { response.writeHead(400); response.end('Missing cwd'); return }
  const data = await getMonWidgetData(cwd)
  respondJson(response, 200, data)
}
```

### 5c. Types partagés

```ts
// shared/types.ts
export interface MonDataType {
  // …
}
```

### 5d. Module backend (si logique métier)

```ts
// server/features/mon-widget/mon-widget.ts
export async function getMonWidgetData(cwd: string): Promise<MonDataType> {
  // Logique métier, accès fichiers, etc.
}
```

Les modules backend n'exposent pas de routes HTTP — cette responsabilité reste dans `server/backend.ts`.

## Composant utilitaire : WidgetLayout

`WidgetLayout` (`src/features/right-sidebar/WidgetLayout.tsx`) fournit une structure optionnelle
avec header fixe et zone de contenu scrollable :

```tsx
import { WidgetLayout } from '../right-sidebar/WidgetLayout.tsx'

<WidgetLayout header={<div><strong>Mon widget</strong><span>sous-titre</span></div>}>
  {/* contenu scrollable */}
</WidgetLayout>
```

Il est utilisé par le widget d'analyse de session, mais n'est pas obligatoire.

## Récapitulatif des fichiers touchés

| Fichier | Action |
|---|---|
| `src/features/<widget>/<Widget>.tsx` | Créer le composant |
| `src/features/right-sidebar/right-sidebar.ts` | Ajouter `rightWidgetDefinitions` |
| `src/features/right-sidebar/RightSidebar.tsx` | Importer, panneau, rail, `panelLabel` |
| `src/App.tsx` | (optionnel) Props et callbacks |
| `src/api.ts` | (optionnel) Fonction de requête |
| `server/backend.ts` | (optionnel) Route HTTP |
| `shared/types.ts` | (optionnel) Types |
| `server/features/<widget>/` | (optionnel) Logique backend |

## Widget de référence

[`TerminalWidget`](../src/features/terminal/TerminalWidget.tsx) est le widget le plus simple
(55 lignes). Il illustre :
- Un état local (`useState`)
- Un appel API (`executeTerminalCommand` depuis `src/api.ts`)
- Un formulaire avec gestion d'erreur
- Le pattern header / contenu / footer
