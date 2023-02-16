const isBrowser =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

type ErrorState = ErrorEvent | null;
type ScriptStatus = {
  loading: boolean;
  error: ErrorState;
  scriptEl: HTMLScriptElement;
};
type ScriptStatusMap = {
  [key: string]: ScriptStatus;
};

// Previously loading/loaded scripts and their current status
export const scripts: ScriptStatusMap = {};

const checkExisting = (src: string): ScriptStatus | undefined => {
  const existing: HTMLScriptElement | null = document.querySelector(
    `script[src="${src}"]`
  );
  if (existing) {
    // Assume existing <script> tag is already loaded,
    // and cache that data for future use.
    return (scripts[src] = {
      loading: false,
      error: null,
      scriptEl: existing,
    });
  }
  return undefined;
};

type CallbackArg = [Omit<ScriptStatus, 'scriptEl'>, (() => void) | undefined];
type Callback = (arg: Omit<ScriptStatus, 'scriptEl'>) => void;
interface Params {
  src: HTMLScriptElement['src'] | null;
  checkForExisting?: boolean;
  loadImmediate?: boolean;
}

// This is a port of the useScript hook, rewritten to not have a dependency on React
export default function loadScript(
  params: Params,
  callback?: Callback
): CallbackArg {
  const { src, checkForExisting, loadImmediate } = params;
  // Check whether some instance of this hook considered this src.
  let status: ScriptStatus | undefined = src ? scripts[src] : undefined;

  // If requested, check for existing <script> tags with this src
  // (unless we've already loaded the script ourselves).
  if (!status && checkForExisting && src && isBrowser) {
    status = checkExisting(src);
  }

  const loading = status?.loading || Boolean(src);
  const error = status?.error || null;
  const scriptLoaded = false;

  const loader = () => {
    // Nothing to do on server, or if no src specified, or
    // if script is already loaded or "error" state.
    if (!isBrowser || !src || scriptLoaded || error) return;

    // Check again for existing <script> tags with this src
    // in case it's changed since mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    status = scripts[src];
    if (!status && checkForExisting) {
      status = checkExisting(src);
    }

    // Determine or create <script> element to listen to.
    let scriptEl: HTMLScriptElement;
    if (status) {
      scriptEl = status.scriptEl;
    } else {
      scriptEl = document.createElement('script');
      scriptEl.src = src;

      status = scripts[src] = {
        loading: true,
        error: null,
        scriptEl: scriptEl,
      };
    }
    // `status` is now guaranteed to be defined: either the old status
    // from a previous load, or a newly created one.

    const handleLoad = () => {
      if (status) status.loading = false;
      callback && callback({ loading: false, error: null });
    };
    const handleError = (error: ErrorEvent) => {
      callback && callback({ loading: false, error: error });
    };

    scriptEl.addEventListener('load', handleLoad);
    scriptEl.addEventListener('error', handleError);

    document.body.appendChild(scriptEl);
  };

  const load = !loadImmediate ? loader : undefined;
  if (!load) loader();

  return [
    {
      loading,
      error,
    },
    load,
  ];
}
