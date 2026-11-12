// In-flight bank requests must not outlive a credential save/clear, even
// when the user stays in the same workspace or re-enters the same app ID.
let revision = 0;

export function getCredentialRevision(): number {
  return revision;
}

export function markCredentialsChanged(): void {
  revision += 1;
}
