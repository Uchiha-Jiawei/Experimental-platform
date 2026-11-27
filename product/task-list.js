// 浏览器产物与验收环境共用此实现。每次重新加载都重新构造应用状态。
export function createTaskList(features, storage, key = 'tasks') {
  let items = features.persist ? JSON.parse(storage.getItem(key) || '[]') : [];
  function save() {
    if (features.persist) storage.setItem(key, JSON.stringify(items));
  }
  return {
    list: () => items.map(item => ({ ...item })),
    add(title) {
      if (features.add && title.trim()) items.push({ title: title.trim(), done: false });
      save();
    },
    complete(index) {
      if (features.complete && items[index]) items[index].done = true;
      save();
    },
  };
}
