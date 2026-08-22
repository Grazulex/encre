import { createRouter, createWebHashHistory } from 'vue-router'
import LibraryView from './views/LibraryView.vue'
import BookView from './views/BookView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: LibraryView },
    { path: '/book/:id', component: BookView, props: (r) => ({ bookId: Number(r.params.id) }) }
  ]
})
