import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  Button as AriaButton,
  FieldError as AriaFieldError,
  Form as AriaForm,
  Input as AriaInput,
  Label as AriaLabel,
  TextField as AriaTextField,
} from 'react-aria-components';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/problem';
import { safeReturnPath, signIn } from '../api/session';
import { Stack, Surface, Text } from '../components/primitives';

const LOCAL_TOKEN_COMMAND = `docker compose exec -T api node -p "require('/data/tokens.json').viewer"`;

/** `/ui/sign-in`: trades a viewer or agent token for the session cookie, then goes back. */
export function SignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(token.trim());
      await queryClient.invalidateQueries();
      const next = safeReturnPath(params.get('next'));
      void navigate(next.replace(/^\/ui(?=\/)/, ''), { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError({ type: 'about:blank', title: 'Sign-in failed', status: 0, code: 'unknown', detail: String(e) }));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-xl">
      <Surface border="secondary" radius="xl" shadow="sm" padding="3xl" className="w-full max-w-96">
        <Stack gap="3xl">
          <Stack gap="xs">
            <Text as="h1" size="display-xs" weight="semibold">
              Sign in
            </Text>
            <Text color="tertiary">Use a viewer or agent token for this server.</Text>
          </Stack>
          <AriaForm onSubmit={e => void submit(e)} validationErrors={error ? { token: error.message } : {}}>
            <Stack gap="xl">
              <AriaTextField name="token" type="password" isRequired value={token} onChange={setToken} autoComplete="off">
                <Stack gap="sm">
                  <AriaLabel className="text-sm font-medium text-secondary">Token</AriaLabel>
                  <AriaInput className="rounded-md border border-primary bg-primary px-lg py-md text-md text-primary shadow-xs outline-none placeholder:text-placeholder focus:border-brand focus:ring-4 focus:ring-brand/24 invalid:border-error" />
                  <AriaFieldError className="text-sm text-error-primary" />
                </Stack>
              </AriaTextField>
              {error?.hint ? <Text color="tertiary">{error.hint}</Text> : null}
              <AriaButton
                type="submit"
                isPending={pending}
                className="rounded-md bg-brand-solid px-lg py-md text-md font-semibold text-white shadow-xs hover:bg-brand-solid_hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand pending:opacity-50"
              >
                {pending ? 'Signing in…' : 'Sign in'}
              </AriaButton>
            </Stack>
          </AriaForm>
          <Stack gap="xs">
            <Text size="xs" color="tertiary">
              Running locally with Docker? Print the viewer token with:
            </Text>
            <Text as="code" size="xs" className="rounded-sm bg-secondary p-sm font-mono break-all">
              {LOCAL_TOKEN_COMMAND}
            </Text>
          </Stack>
        </Stack>
      </Surface>
    </main>
  );
}
