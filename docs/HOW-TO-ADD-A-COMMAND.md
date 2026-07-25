# Ajouter une commande

Ce guide couvre l'ajout d'une commande dans la palette et le système de raccourcis clavier.
Chaque étape est obligatoire. La commande `open-palette` sert de référence minimale.

Une commande de widget (barre latérale) est créée automatiquement : voir
[HOW-TO-ADD-A-WIDGET.md](HOW-TO-ADD-A-WIDGET.md).

## 1. Définir la commande

Ajoute l'identifiant dans `CoreCommandId` et l'entrée dans `commandDefinitions` :

```ts
// src/features/commands/command-registry.ts

type CoreCommandId =
  // … existants …
  | 'ma-commande'

export const commandDefinitions: CommandDefinition[] = [
  // … existants …
  { id: 'ma-commande', label: 'Ma commande' },
  // … widgets automatiques …
]
```

L'identifiant devient disponible dans `CommandId` et `commandDefinitions` immédiatement.
La commande apparaît dans la palette sans autre inscription.

## 2. (Optionnel) Ajouter un raccourci par défaut

```ts
// src/features/commands/command-registry.ts

export const defaultShortcuts: Partial<Record<CommandId, string>> = {
  // … existants …
  'ma-commande': 'mod+shift+m',
}
```

Les modifieurs utilisent `mod` (Cmd sur Mac, Ctrl sinon), `alt`, `shift`. La normalisation est
gérée par `shortcutFromEvent`. Une commande sans raccourci par défaut reste assignable depuis
les paramètres (Settings).

## 3. Implémenter l'exécution dans App.tsx

Ajoute un cas dans `executeCommand` :

```ts
// src/App.tsx — dans la fonction executeCommand

if (id === 'ma-commande') {
  // Action : ouvrir un dialogue, basculer un état, lancer une requête…
  setMonEtat(true)
  return
}
```

## 4. (Optionnel) Rendre la commande conditionnelle

Si la commande n'a de sens que dans certains contextes (session active, données chargées…),
ajoute sa condition de désactivation dans `paletteCommands` :

```ts
// src/App.tsx — dans le useMemo de paletteCommands

const paletteCommands: PaletteCommand[] = useMemo(() => commandDefinitions.map((definition) => {
  // …
  return {
    …definition,
    shortcut: shortcuts[definition.id],
    disabled: unavailableWidget
      || (definition.id === 'ma-commande' && !maCondition)
      || (['send', 'abort', …].includes(definition.id) && !selectedSession),
    onExecute: () => executeCommand(definition.id),
  }
}), […])
```

Une commande désactivée reste visible dans la palette mais grisée et non cliquable.

## 5. Couvrir dans les tests

Ajouter un test dans `test/shortcuts.test.ts` si la commande introduit un nouveau comportement
de normalisation, de conflit de raccourcis, ou de résolution :

```ts
// test/shortcuts.test.ts

test('ma-commande est reconnue par le registre', () => {
  const definition = commandDefinitions.find((d) => d.id === 'ma-commande')
  assert.ok(definition)
  assert.equal(definition.label, 'Ma commande')
})
```

## Récapitulatif des fichiers touchés

| Fichier | Action |
|---|---|
| `src/features/commands/command-registry.ts` | `CoreCommandId`, `commandDefinitions`, (optionnel) `defaultShortcuts` |
| `src/App.tsx` | `executeCommand`, (optionnel) désactivation dans `paletteCommands` |
| `test/shortcuts.test.ts` | (optionnel) Test de registre ou conflit |
