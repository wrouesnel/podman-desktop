<script lang="ts">
// test stub of KubernetesTerminal
interface Props {
  sessionKey: string;
}
let { sessionKey }: Props = $props();
</script>

<div>terminal {sessionKey}</div>
