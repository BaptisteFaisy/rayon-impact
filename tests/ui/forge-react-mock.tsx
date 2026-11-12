/**
 * Doublure de `@forge/react` pour les tests : chaque primitive est rendue par
 * un vrai élément HTML, pour que le markup inspecté par les tests (rôles,
 * libellés, ancres sémantiques) reste du HTML et non une suite de noms de
 * composants.
 *
 * En production, `@forge/react` expose des constantes de nom ("Box", "Text"…) que
 * le moteur de rendu d'Atlassian sait dessiner. En test, on veut du HTML.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { createElement, Fragment as ReactFragment, type ReactNode } from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };

/** Un composant HTML simple, sans embellissement. */
function html(tag: string) {
  return function Composant(props: Props): ReactNode {
    const { children, ...rest } = props;
    return createElement(tag, rest, children);
  };
}

/** Bouton : la plateforme appelle la désactivation `isDisabled`. */
export const Button = function Bouton(props: Props): ReactNode {
  const { children, isDisabled, ...rest } = props;
  return createElement('button', { ...rest, disabled: isDisabled, children });
};

/** Titre : la plateforme demande le niveau dans `as`. */
export const Heading = function Titre(props: Props): ReactNode {
  const { children, as, ...rest } = props;
  return createElement(typeof as === 'string' ? as : 'h2', rest, children);
};

/** Liste : `type` vaut « unordered » ou « ordered ». */
export const List = function Liste(props: Props): ReactNode {
  const { children, type, ...rest } = props;
  return createElement(type === 'ordered' ? 'ol' : 'ul', rest, children);
};

/** Liste déroulante : options rendues en `<option>`. */
export const Select = function ListeDeroulante(props: Props): ReactNode {
  const { children, options, inputId, value, ...rest } = props;
  const choix = Array.isArray(options) ? (options as { label: string; value: unknown }[]) : [];
  return createElement(
    'select',
    { ...rest, id: inputId, value },
    children,
    choix.map((option) =>
      createElement('option', { key: String(option.value), value: option.value }, option.label),
    ),
  );
};

/** Zone de texte : la plateforme demande la taille minimale. */
export const TextArea = function ZoneDeTexte(props: Props): ReactNode {
  const { children, minimumRows, ...rest } = props;
  return createElement('textarea', { ...rest, rows: minimumRows, children });
};

/** Étiquette : la plateforme attend `labelFor`. */
export const Label = function Etiquette(props: Props): ReactNode {
  const { children, labelFor, ...rest } = props;
  return createElement('label', { ...rest, htmlFor: labelFor, children });
};

/** Case à cocher : la plateforme appelle l'état `isChecked`. */
export const Checkbox = function Case(props: Props): ReactNode {
  const { children, isChecked, ...rest } = props;
  return createElement('input', { type: 'checkbox', checked: isChecked, ...rest, children });
};

export const Box = html('div');
export const Stack = html('div');
export const Text = html('span');
export const Badge = html('span');
export const Lozenge = html('span');
export const SectionMessage = html('div');
export const Tab = html('div');
export const TabList = html('div');
export const TabPanel = html('div');
export const Tabs = html('div');
export const Textfield = html('input');
export const Link = html('a');
export const ListItem = html('li');
export const Spinner = html('span');
export const Form = html('form');
export const FormSection = html('fieldset');
export const FormFooter = html('div');
export const FormHeader = html('div');
export const Frame = html('div');
export const Icon = html('span');
export const Inline = html('span');
export const Code = html('code');
export const EmptyState = html('div');
export const HelperMessage = html('span');
export const ProgressBar = html('div');
export const RadioGroup = html('div');
export const Tag = html('span');
export const Toggle = html('input');
export const Tooltip = html('span');
export const Modal = html('div');
export const ModalBody = html('div');
export const ModalFooter = html('div');
export const ModalHeader = html('div');
export const ModalTitle = html('h2');
export const DynamicTable = html('table');
export const I18nProvider = html('div');
export const Strong = html('strong');
export const Em = html('em');
export const Strike = html('s');
export const Image = html('img');
export const User = html('span');
export const UserGroup = html('span');
export const UserPicker = html('span');
export const InlineEdit = html('div');
export const Popup = html('div');
export const AdfRenderer = html('div');
export const CodeBlock = html('pre');
export const EmptyStateIcon = html('span');

export const Fragment = ReactFragment;
export const useTranslation = () => ({ t: (key: string) => key });
export const useProductContext = () => undefined;

export default { render: () => undefined };
