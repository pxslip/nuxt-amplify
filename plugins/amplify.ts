import { Amplify } from 'aws-amplify';

export default defineNuxtPlugin(() => {
  Amplify.configure({ ssr: true });
});
