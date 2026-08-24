import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useThemeStore } from './stores/theme'
import './styles/theme.css'

const pinia = createPinia()

// Le thème choisit ses variables CSS AVANT le premier rendu (posées sur
// documentElement dès le boot, avant mount) : pas de flash de la palette par
// défaut quand la préférence mémorisée diffère du système.
useThemeStore(pinia).init()

createApp(App).use(pinia).use(router).mount('#app')
