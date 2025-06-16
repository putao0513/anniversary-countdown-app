import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, query, getDoc, setDoc } from 'firebase/firestore';

// 定义预设的纪念日事件
const FIXED_INITIAL_EVENTS = [
  { name: "第一次见面", date: "2021-10-18", type: "anniversary" },
  { name: "恋爱正式第一天", date: "2022-06-11", type: "anniversary" },
  { name: "宝宝的生日", date: "2024-05-13", type: "anniversary" } // 使用一个具体年份作为纪念日计算基准
];

// App 组件：纪念日与倒数日管理应用
const App = () => {
  // 状态：存储所有事件
  const [events, setEvents] = useState([]);
  // 状态：用于表单输入
  const [newEventName, setNewEventName] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newEventType, setNewEventType] = useState('anniversary');
  const [password, setPassword] = useState(''); // 新增密码状态

  // 状态：Firebase 相关
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  // 状态：表单消息（成功/错误提示）
  const [formMessage, setFormMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success' 或 'error'

  // 导航状态：'view' 用于查看事件，'add' 用于添加事件
  const [currentPage, setCurrentPage] = useState('view');

  // Firebase 初始化和认证逻辑
  useEffect(() => {
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
      const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestore);
      setAuth(firebaseAuth);

      const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
        } else {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (error) {
            console.error("Firebase Auth Error:", error);
            setLoading(false);
          }
        }
      });

      return () => unsubscribeAuth();
    } catch (error) {
      console.error("Firebase Initialization Error:", error);
      setLoading(false);
    }
  }, []);

  // 监听 Firestore 数据变化并处理初始事件添加
  useEffect(() => {
    if (isAuthReady && db && userId) {
      setLoading(true);
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; // 确保在这里定义appId
      const eventsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/events`);
      // 使用一个特定的文档来标记是否已初始化预设事件
      // 修正了Firestore文档路径的构建方式，确保路径段数正确
      // 将 _appSettings 视为 userSettings 集合下的一个名为 'config' 的文档
      const userSettingsDocRef = doc(db, 'artifacts', appId, 'users', userId, 'userSettings', 'config');

      // 异步函数：检查并添加预设事件
      const checkAndAddInitialEvents = async () => {
        try {
          const userSettingsDoc = await getDoc(userSettingsDocRef);
          if (!userSettingsDoc.exists() || !userSettingsDoc.data().fixedEventsInitialized) {
            // 如果未初始化预设事件，则添加它们
            for (const event of FIXED_INITIAL_EVENTS) {
              await addDoc(eventsCollectionRef, event);
            }
            // 标记为已初始化，防止重复添加
            await setDoc(userSettingsDocRef, { fixedEventsInitialized: true }, { merge: true });
          }
        } catch (error) {
          console.error("Error checking/adding initial events:", error);
        }
      };

      checkAndAddInitialEvents(); // 调用函数

      // 实时监听事件集合
      const q = query(eventsCollectionRef);
      const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        const eventsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        // 按照日期排序
        eventsData.sort((a, b) => new Date(a.date) - new Date(b.date));
        setEvents(eventsData);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching events:", error);
        setLoading(false);
      });

      return () => unsubscribeSnapshot();
    }
  }, [isAuthReady, db, userId]);

  /**
   * 计算目标日期与今天之间的天数差异。
   * 对于纪念日，计算已过去的天数。
   * 对于倒数日，计算剩余天数，或已过去的天数（如果日期已过）。
   * @param {string} targetDate - 目标日期字符串 (例如: 'YYYY-MM-DD')
   * @param {'anniversary' | 'countdown'} type - 事件类型
   * @returns {string} - 描述天数差异的字符串
   */
  const calculateDays = (targetDate, type) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (type === 'anniversary') {
      if (diffDays >= 0) {
        return `已过 0 天`;
      } else {
        return `已过 ${Math.abs(diffDays)} 天`;
      }
    } else { // 倒数日
      if (diffDays === 0) {
        return '今天！';
      } else if (diffDays > 0) {
        return `还剩 ${diffDays} 天`;
      } else {
        return `已过 ${Math.abs(diffDays)} 天`;
      }
    }
  };

  /**
   * 显示临时的表单消息。
   * @param {string} message - 要显示的消息
   * @param {string} type - 消息类型 ('success' 或 'error')
   */
  const showFormMessage = (message, type) => {
    setFormMessage(message);
    setMessageType(type);
    const timeout = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
      setFormMessage('');
      setMessageType('');
    }, timeout);
  };

  /**
   * 处理添加新事件的表单提交。
   * @param {Event} e - 表单提交事件
   */
  const handleAddEvent = async (e) => {
    e.preventDefault();

    if (!newEventName.trim() || !newEndDate) {
      showFormMessage('请填写所有字段！', 'error');
      return;
    }

    // 密码验证
    if (password !== 'ccxzq888') {
      showFormMessage('密码不正确！', 'error');
      setPassword(''); // 清空密码输入框
      return;
    }

    if (!db || !userId) {
      showFormMessage('数据库未准备好，请稍候再试。', 'error');
      return;
    }

    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const eventsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/events`);
      await addDoc(eventsCollectionRef, {
        name: newEventName.trim(),
        date: newEndDate,
        type: newEventType,
        createdAt: new Date().toISOString()
      });
      showFormMessage('事件添加成功！', 'success');
      setNewEventName('');
      setNewEndDate('');
      setNewEventType('anniversary');
      setPassword(''); // 成功添加后清空密码
    } catch (error) {
      console.error("Error adding document: ", error);
      showFormMessage('添加事件失败，请重试。', 'error');
    }
  };

  /**
   * 从事件列表中移除指定ID的事件。
   * @param {string} id - 要移除事件的Firestore文档ID
   */
  const handleRemoveEvent = async (id) => {
    if (!db || !userId) {
      showFormMessage('数据库未准备好，请稍候再试。', 'error');
      return;
    }
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const docRef = doc(db, `artifacts/${appId}/users/${userId}/events`, id);
      await deleteDoc(docRef);
      showFormMessage('事件删除成功！', 'success');
    } catch (error) {
      console.error("Error removing document: ", error);
      showFormMessage('删除事件失败，请重试。', 'error');
    }
  };

  // 加载状态显示
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center font-inter">
        <p className="text-xl text-gray-700">加载中... 请稍候</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 flex flex-col items-center p-4 font-inter">
      {/* 标题 */}
      <h1 className="text-5xl font-extrabold text-gray-900 mb-6 mt-6 drop-shadow-lg text-center">
        纪念日与倒数日
      </h1>

      {/* 导航栏 */}
      <nav className="mb-8 flex justify-center space-x-4">
        <button
          onClick={() => setCurrentPage('view')}
          className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition duration-200 ease-in-out transform hover:scale-105 active:scale-95
            ${currentPage === 'view' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-50 hover:text-blue-800'}`
          }
        >
          查看所有事件
        </button>
        <button
          onClick={() => setCurrentPage('add')}
          className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition duration-200 ease-in-out transform hover:scale-105 active:scale-95
            ${currentPage === 'add' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-50 hover:text-blue-800'}`
          }
        >
          添加新事件
        </button>
      </nav>

      {/* 显示用户ID */}
      {userId && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-lg text-sm mb-6 shadow-sm">
          您的用户ID: <span className="font-mono text-blue-800 break-all">{userId}</span>
        </div>
      )}

      {/* 根据 currentPage 渲染不同的内容 */}
      {currentPage === 'view' ? (
        // 事件列表
        <div className="w-full max-w-4xl px-4">
          {events.length === 0 ? (
            <p className="text-gray-600 text-center text-xl mt-8">暂无事件，快添加一个吧！🎉</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="bg-white p-6 rounded-2xl shadow-lg flex flex-col justify-between transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl border border-gray-200"
                >
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2 truncate">
                      {event.name}
                    </h3>
                    <p className="text-gray-600 text-sm mb-3">
                      日期: {new Date(event.date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    <p className={`text-4xl font-extrabold ${event.type === 'countdown' && calculateDays(event.date, event.type).startsWith('还剩') ? 'text-green-600' : 'text-blue-600'} mb-4`}>
                      {calculateDays(event.date, event.type)}
                    </p>
                  </div>
                  {/* 条件渲染删除按钮：纪念日类型不显示删除按钮 */}
                  {event.type !== 'anniversary' && (
                    <button
                      onClick={() => handleRemoveEvent(event.id)}
                      className="mt-4 bg-red-500 hover:bg-red-600 text-white text-base py-2 px-4 rounded-lg shadow-md transition duration-200 ease-in-out self-end transform hover:scale-105 active:scale-95"
                    >
                      删除
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // 添加新事件表单
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-lg mb-10 transform transition-all duration-300 hover:scale-[1.01]">
          <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">添加新事件</h2>
          <form onSubmit={handleAddEvent} className="space-y-6">
            <div>
              <label htmlFor="eventName" className="block text-base font-medium text-gray-700 mb-1">
                事件名称:
              </label>
              <input
                type="text"
                id="eventName"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-base placeholder-gray-400"
                placeholder="例如：结婚纪念日"
                required
              />
            </div>
            <div>
              <label htmlFor="eventDate" className="block text-base font-medium text-gray-700 mb-1">
                目标日期:
              </label>
              <input
                type="date"
                id="eventDate"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-base"
                required
              />
            </div>
            <div>
              <label htmlFor="eventType" className="block text-base font-medium text-gray-700 mb-1">
                事件类型:
              </label>
              <select
                id="eventType"
                value={newEventType}
                onChange={(e) => setNewEventType(e.target.value)}
                className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-base"
              >
                <option value="anniversary">纪念日 (计算已过天数)</option>
                <option value="countdown">倒数日 (计算剩余天数)</option>
              </select>
            </div>
            <div>
              <label htmlFor="password" className="block text-base font-medium text-gray-700 mb-1">
                密码:
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-base placeholder-gray-400"
                placeholder="请输入密码"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                (提示: 当前密码验证在客户端进行，生产环境推荐更安全的后端验证。)
              </p>
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition duration-200 ease-in-out transform hover:scale-105 active:scale-95 text-lg"
              disabled={!isAuthReady}
            >
              {isAuthReady ? '添加事件' : '正在加载认证...'}
            </button>
            {formMessage && (
              <p className={`mt-2 text-sm text-center font-medium ${messageType === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                {formMessage}
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
};

export default App;
