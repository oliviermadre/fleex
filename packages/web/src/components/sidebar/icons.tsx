interface IconProps {
  size?: number;
  className?: string;
}

export function GitForkIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="11" cy="3.5" r="1.5" />
      <circle cx="8" cy="12.5" r="1.5" />
      <line x1="5" y1="5" x2="5" y2="7" />
      <line x1="11" y1="5" x2="11" y2="7" />
      <path d="M5 7c0 1.5 1.5 2.5 3 4M11 7c0 1.5-1.5 2.5-3 4" />
    </svg>
  );
}

export function ClaudeIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 509.64"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      className={className}
    >
      <path d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z" />
    </svg>
  );
}

export function TerminalIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <polyline points="4.5,6.5 7,9 4.5,11.5" />
      <line x1="9" y1="11.5" x2="11.5" y2="11.5" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 8.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4H8" />
      <path d="M10 2h4v4" />
      <path d="M7 9L14 2" />
    </svg>
  );
}

export function RefreshCwIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M13.5 2.5v3.5h-3.5" />
      <path d="M2.5 13.5v-3.5h3.5" />
      <path d="M3.5 5.5a5 5 0 0 1 8.3-1.5l1.7 2" />
      <path d="M12.5 10.5a5 5 0 0 1-8.3 1.5l-1.7-2" />
    </svg>
  );
}

export function VimIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2 3l4.5 10M14 3l-4.5 10" />
      <path d="M1 3h4M11 3h4" />
    </svg>
  );
}

export function NodeIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M8 1.5l5.5 3.25v6.5L8 14.5l-5.5-3.25v-6.5L8 1.5z" />
    </svg>
  );
}

export function PythonIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5.5 1.5h5a2 2 0 012 2v2.5a2 2 0 01-2 2H5.5a2 2 0 00-2 2V12.5a2 2 0 002 2h5" />
      <path d="M10.5 14.5h-5a2 2 0 01-2-2v-2.5a2 2 0 012-2h5a2 2 0 002-2V3.5a2 2 0 00-2-2h-5" />
      <circle cx="6.5" cy="3.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="12.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GitIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="12" cy="4" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <line x1="4" y1="5.5" x2="4" y2="10.5" />
      <path d="M12 5.5v1a2 2 0 01-2 2H6" />
    </svg>
  );
}

export function K9sIcon({ size = 16, className }: IconProps) {
  // Kubernetes helm wheel — colors from official logo
  const r = 4.2;
  const spokes = 7;
  const spokeLines = Array.from({ length: spokes }, (_, i) => {
    const angle = (i * 2 * Math.PI) / spokes - Math.PI / 2;
    const x2 = 8 + r * Math.cos(angle);
    const y2 = 8 + r * Math.sin(angle);
    return <line key={i} x1="8" y1="8" x2={x2.toFixed(2)} y2={y2.toFixed(2)} />;
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
    >
      {/* Blue heptagon background */}
      <polygon
        points="8,0.8 13.2,2.8 15.2,7.8 13.5,12.8 9.2,15.2 6.8,15.2 2.5,12.8 0.8,7.8 2.8,2.8"
        fill="#326ce5"
      />
      {/* White helm spokes */}
      <g stroke="white" strokeWidth="1" strokeLinecap="round">
        {spokeLines}
      </g>
      {/* Center dot */}
      <circle cx="8" cy="8" r="1.5" fill="#326ce5" stroke="white" strokeWidth="1" />
    </svg>
  );
}

export function HtopIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className={className}
    >
      <rect x="2" y="3" width="3" height="10" rx="0.5" />
      <rect x="6.5" y="6" width="3" height="7" rx="0.5" />
      <rect x="11" y="1" width="3" height="12" rx="0.5" />
    </svg>
  );
}

type IconComponent = React.ComponentType<IconProps>;

export function getProcessIcon(processName?: string): IconComponent | null {
  if (!processName) return null;
  const cmd = processName.split(' ')[0];
  switch (cmd) {
    case 'claude': return ClaudeIcon;
    case 'vim': case 'nvim': return VimIcon;
    case 'node': return NodeIcon;
    case 'python': case 'python3': return PythonIcon;
    case 'git': return GitIcon;
    case 'k9s': return K9sIcon;
    case 'htop': case 'btop': case 'top': return HtopIcon;
    default: return null;
  }
}

export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}
