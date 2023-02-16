import { useState, useEffect } from 'react';

import loadScript from './loadScript';

interface ScriptProps {
  src: HTMLScriptElement['src'] | null;
  checkForExisting?: boolean;
  [key: string]: any;
}
type ErrorState = ErrorEvent | null;

export default function useScript({
  src,
  checkForExisting = false,
}: ScriptProps): [boolean, ErrorState] {
  let asyncCallback: Parameters<typeof loadScript>[1] | undefined = undefined;
  const [status, load] = loadScript(
    {
      src,
      checkForExisting,
      loadImmediate: false,
    },
    arg => {
      asyncCallback && asyncCallback(arg);
    }
  );

  const [loading, setLoading] = useState<boolean>(
    status ? status.loading : Boolean(src)
  );
  const [error, setError] = useState<ErrorState>(status ? status.error : null);

  asyncCallback = ({ loading, error }) => {
    setLoading(loading);
    setError(error);
  };

  useEffect(() => {
    load && load();
  }, [src]);

  return [loading, error];
}
