import { createElement, type ComponentType, type ReactNode } from 'react';
import * as primitives from '../../tests/ui/forge-react-mock';

/**
 * Demo kit: the SAME components the app mounts, dressed for a browser.
 *
 * `tests/ui/forge-react-mock.tsx` renders every platform primitive to a plain
 * HTML element so the test suite can inspect roles, labels and anchors. That
 * markup is correct but unstyled, which is invisible inside Jira (the platform
 * draws it) and ugly in the offline demo. This module wraps the test mock and
 * adds the Atlaskit-flavoured class names the demo stylesheet expects — no
 * second implementation of a screen, no change to the tests.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Class name of each primitive, mirroring the Atlaskit element it stands for. */
const CLASS_OF: Record<string, string> = {
  Box: 'box',
  Stack: 'stack',
  Text: 'text',
  Strong: 'strong',
  Em: 'em',
  Code: 'code',
  Heading: 'heading',
  Button: 'button',
  Badge: 'badge',
  Lozenge: 'lozenge',
  Link: 'link',
  List: 'list',
  ListItem: 'list-item',
  SectionMessage: 'section-message',
  Label: 'label',
  Select: 'select',
  Textfield: 'textfield',
  TextArea: 'textarea',
  Checkbox: 'checkbox',
  Toggle: 'toggle',
  Tabs: 'tabs',
  TabList: 'tab-list',
  Tab: 'tab',
  TabPanel: 'tab-panel',
  Form: 'form',
  FormSection: 'form-section',
  FormFooter: 'form-footer',
  FormHeader: 'form-header',
  Frame: 'frame',
  Icon: 'icon',
  Inline: 'inline',
  Modal: 'modal',
  ModalBody: 'modal-body',
  ModalFooter: 'modal-footer',
  ModalHeader: 'modal-header',
  ModalTitle: 'modal-title',
  DynamicTable: 'table',
  EmptyState: 'empty-state',
  HelperMessage: 'helper',
  ProgressBar: 'progress',
  RadioGroup: 'radio-group',
  Tag: 'tag',
  Tooltip: 'tooltip',
  Spinner: 'spinner',
  Image: 'image',
  User: 'user',
  UserGroup: 'user-group',
  CodeBlock: 'code-block',
  AdfRenderer: 'adf',
  I18nProvider: 'i18n',
  InlineEdit: 'inline-edit',
  Popup: 'popup',
  UserPicker: 'user-picker',
  EmptyStateIcon: 'icon',
};

/** `appearance` of a platform primitive, mapped to a demo modifier class. */
const APPEARANCE_MODIFIER: Record<string, string> = {
  default: 'default',
  primary: 'primary',
  subtle: 'subtle',
  success: 'success',
  info: 'info',
  notice: 'notice',
  warning: 'warning',
  error: 'error',
  removed: 'removed',
  inprogress: 'inprogress',
  new: 'new',
  strong: 'strong',
  premium: 'premium',
};

/** Merges the demo class with any className the screen already passes. */
function classNames(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** The modifier classes an `appearance` prop brings (`Lozenge appearance="removed"`). */
function appearanceClasses(component: string, appearance: unknown): string {
  const base = CLASS_OF[component];
  const modifier = typeof appearance === 'string' ? APPEARANCE_MODIFIER[appearance] : undefined;
  if (!modifier) return '';
  return `${base}--${modifier}`;
}

/** Wraps one mock primitive: same element, same props, plus the demo classes. */
function dressed(name: string, Original: ComponentType<Record<string, unknown>>): ComponentType<Record<string, unknown>> {
  return function Dressed(props: Record<string, unknown>): ReactNode {
    const { className, appearance, ...rest } = props;
    return createElement(Original, {
      ...rest,
      className: classNames(CLASS_OF[name], appearanceClasses(name, appearance), className as string),
    });
  };
}

/** Any export of the test mock, dressed once and remembered. */
const dressedCache = new Map<string, unknown>();

/** Pulls one primitive by name: dressed when it is a known component. */
function pick(name: string): unknown {
  if (dressedCache.has(name)) return dressedCache.get(name);
  const original = (primitives as Record<string, unknown>)[name];
  const value =
    typeof original === 'function' && CLASS_OF[name]
      ? dressed(name, original as ComponentType<Record<string, unknown>>)
      : original;
  dressedCache.set(name, value);
  return value;
}

/**
 * Named exports, one per line: a destructured `export const { A, B } = obj`
 * makes esbuild rename the symbols (Heading → Heading7) and the screens then
 * reference an undefined binding at runtime. Explicit names stay stable.
 */
export const Badge = pick('Badge');
export const Box = pick('Box');
export const Button = pick('Button');
export const Checkbox = pick('Checkbox');
export const Code = pick('Code');
export const DynamicTable = pick('DynamicTable');
export const Em = pick('Em');
export const EmptyState = pick('EmptyState');
export const Form = pick('Form');
export const FormFooter = pick('FormFooter');
export const FormHeader = pick('FormHeader');
export const FormSection = pick('FormSection');
export const Frame = pick('Frame');
export const Heading = pick('Heading');
export const HelperMessage = pick('HelperMessage');
export const I18nProvider = pick('I18nProvider');
export const Icon = pick('Icon');
export const Image = pick('Image');
export const Inline = pick('Inline');
export const Label = pick('Label');
export const Link = pick('Link');
export const List = pick('List');
export const ListItem = pick('ListItem');
export const Lozenge = pick('Lozenge');
export const Modal = pick('Modal');
export const ModalBody = pick('ModalBody');
export const ModalFooter = pick('ModalFooter');
export const ModalHeader = pick('ModalHeader');
export const ModalTitle = pick('ModalTitle');
export const ProgressBar = pick('ProgressBar');
export const RadioGroup = pick('RadioGroup');
export const SectionMessage = pick('SectionMessage');
export const Select = pick('Select');
export const Spinner = pick('Spinner');
export const Stack = pick('Stack');
export const Strong = pick('Strong');
export const Tab = pick('Tab');
export const TabList = pick('TabList');
export const TabPanel = pick('TabPanel');
export const Tabs = pick('Tabs');
export const Tag = pick('Tag');
export const TextArea = pick('TextArea');
export const Text = pick('Text');
export const Textfield = pick('Textfield');
export const Toggle = pick('Toggle');
export const Tooltip = pick('Tooltip');
export const Fragment = pick('Fragment');
export const useProductContext = pick('useProductContext');
export const useTranslation = pick('useTranslation');

export default primitives;
