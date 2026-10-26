import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: string[], name: string) {
  const Icon = ({ size = 18, ...props }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

export const UploadIcon = make(['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'], 'UploadIcon');
export const DownloadIcon = make(['M12 4v12', 'M7 11l5 5 5-5', 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'], 'DownloadIcon');
export const FileIcon = make(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'], 'FileIcon');
export const CopyIcon = make(['M9 9h10v10H9z', 'M5 15V5h10'], 'CopyIcon');
export const CheckIcon = make(['M5 12l5 5L20 7'], 'CheckIcon');
export const TrashIcon = make(['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'], 'TrashIcon');
export const LockIcon = make(['M6 11h12v9H6z', 'M8 11V8a4 4 0 0 1 8 0v3'], 'LockIcon');
export const LinkIcon = make(['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'], 'LinkIcon');
export const InboxIcon = make(['M4 13h4l2 3h4l2-3h4', 'M4 13l2-8h12l2 8v6H4z'], 'InboxIcon');
export const SendIcon = make(['M4 12l16-8-6 16-3-7z', 'M11 13l9-9'], 'SendIcon');
export const ListIcon = make(['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'], 'ListIcon');
export const SettingsIcon = make(['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'], 'SettingsIcon');
export const XIcon = make(['M6 6l12 12', 'M18 6L6 18'], 'XIcon');
export const AlertIcon = make(['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'], 'AlertIcon');
export const ClockIcon = make(['M12 7v5l3 2', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'], 'ClockIcon');
export const EyeIcon = make(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], 'EyeIcon');
export const ShieldIcon = make(['M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z'], 'ShieldIcon');
export const PlusIcon = make(['M12 5v14', 'M5 12h14'], 'PlusIcon');
export const ArrowLeftIcon = make(['M19 12H5', 'M11 6l-6 6 6 6'], 'ArrowLeftIcon');
export const SunIcon = make(['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M4.93 19.07l1.41-1.41', 'M17.66 6.34l1.41-1.41'], 'SunIcon');
export const MoonIcon = make(['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'], 'MoonIcon');
export const MonitorIcon = make(['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'], 'MonitorIcon');
export const GitHubIcon = make(
  ['M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21'],
  'GitHubIcon',
);
export const GlobeIcon = make(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'], 'GlobeIcon');
