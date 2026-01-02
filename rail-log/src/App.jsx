import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { Train, Calendar, Clock, LogOut, PlusCircle, List, Trash2, ChevronRight, Search, Edit2, X } from 'lucide-react'
import './App.css'

function App() {
  const [session, setSession] = useState(null)
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('record')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)

  const [formData, setFormData] = useState({
    ride_date: new Date().toISOString().split('T')[0],
    railway_company: '', line_name: '', destination: '', train_number: '',
    operation_number: '', formation_number: '', service_type: '',
    service_color: 'bg-skyblue', // 初期値
    car_number: '', departure_station: '', arrival_station: '',
    departure_time: '', arrival_time: '', memo: ''
  })

  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // 50px以上スクロールしたらコンパクトモードにする
      if (window.scrollY > 50) {
        setIsCompact(true);
      } else {
        setIsCompact(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchRides()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchRides()
    })
    return () => subscription.unsubscribe()
  }, [])

  const suggestions = useMemo(() => {
    const getUnique = (key) => [...new Set(rides.map(r => r[key]).filter(Boolean))]
    return {
      companies: getUnique('railway_company'),
      lines: getUnique('line_name'),
      services: getUnique('service_type'),
      stations: [...new Set([...rides.map(r => r.departure_station), ...rides.map(r => r.arrival_station)].filter(Boolean))]
    }
  }, [rides])

  const filteredRides = useMemo(() => {
    const query = searchQuery.toLowerCase()
    return rides.filter(ride =>
      ride.line_name?.toLowerCase().includes(query) ||
      ride.formation_number?.toLowerCase().includes(query) ||
      ride.railway_company?.toLowerCase().includes(query) ||
      ride.train_number?.toLowerCase().includes(query) ||
      ride.departure_station?.toLowerCase().includes(query) ||
      ride.arrival_station?.toLowerCase().includes(query) ||
      ride.destination?.toLowerCase().includes(query) ||
      ride.memo?.toLowerCase().includes(query)
    )
  }, [rides, searchQuery])

  const groupedRides = useMemo(() => {
    const groups = {}
    filteredRides.forEach(ride => {
      const date = ride.ride_date
      if (!groups[date]) groups[date] = []
      groups[date].push(ride)
    })
    return groups
  }, [filteredRides])

  const fetchRides = async () => {
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .order('ride_date', { ascending: false })
      .order('departure_time', { ascending: true })
      .order('created_at', { ascending: true })
    if (!error) setRides(data)
  }

  // 路線名や種別から過去の色設定を推測する
  const handleInputChange = (field, value) => {
    const newFormData = { ...formData, [field]: value };

    if (field === 'line_name' || field === 'service_type') {
      const line = field === 'line_name' ? value : formData.line_name;
      const service = field === 'service_type' ? value : formData.service_type;

      // 過去の履歴から一致するものを探す
      const match = rides.find(r => r.line_name === line && r.service_type === service);
      if (match && match.service_color) {
        newFormData.service_color = match.service_color;
      }
    }

    setFormData(newFormData);
  };

  const handleEditStart = (ride) => {
    setEditingId(ride.id)
    setFormData({ ...ride, service_color: ride.service_color || getServiceColor(ride.service_type) })
    setActiveTab('record')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setFormData({
      ride_date: new Date().toISOString().split('T')[0],
      railway_company: '', line_name: '', destination: '', train_number: '',
      operation_number: '', formation_number: '', service_type: '',
      service_color: 'bg-skyblue',
      car_number: '', departure_station: '', arrival_station: '',
      departure_time: '', arrival_time: '', memo: ''
    })
  }

  const handleDelete = async (id) => {
    if (!confirm('この記録を削除しますか？')) return
    const { error } = await supabase.from('rides').delete().eq('id', id)
    if (!error) fetchRides()
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setLoading(true)
    const result = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    if (result.error) alert(result.error.message)
    setLoading(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    const payload = { ...formData, user_id: session.user.id }
    let error;

    if (editingId) {
      const result = await supabase.from('rides').update(payload).eq('id', editingId)
      error = result.error
    } else {
      const result = await supabase.from('rides').insert([payload])
      error = result.error
    }

    if (!error) {
      alert(editingId ? '更新しました！' : '記録しました！')
      setEditingId(null)
      fetchRides()
      setFormData(prev => ({
        ...prev, train_number: '', operation_number: '', formation_number: '',
        car_number: '', departure_station: prev.arrival_station,
        arrival_station: '', departure_time: '', arrival_time: '', memo: ''
      }))
      setActiveTab('history')
    } else {
      alert('エラーが発生しました: ' + error.message)
    }
    setLoading(false)
  }

  const getServiceColor = (type) => {
    if (!type) return 'bg-gray'
    if (type.includes('特急') || type.includes('快速') || type.includes('急行')) return 'bg-red'
    if (type.includes('普通') || type.includes('各駅停車')) return 'bg-blue'
    return 'bg-gray'
  }

  const renderServiceType = (type) => {
    if (!type) return '普通';

    const target = "Fライナー";
    if (type.includes(target)) {
      // 文字列を "Fライナー" で分割する
      const parts = type.split(target);
      return (
        <span className="service-with-logo" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {/* 前にある文字（あれば） */}
          {parts[0]}
          {/* 文字の代わりに画像を表示 */}
          <img src="public/Fライナー.png" alt="Fライナー" className="f-liner-logo" />
          {/* 後ろにある文字（"特急" など） */}
          {parts[1]}
        </span>
      );
    }
    return type;
  };

  if (!session) {
    return (
      <div className="container auth-container">
        <div className="card text-center auth-card">
          <div className="auth-logo">🚆</div>
          <h1 className="auth-title">乗車記録</h1>
          <form onSubmit={handleAuth} className="auth-form">
            <input type="email" placeholder="メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="password" placeholder="パスワード" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" className="primary" disabled={loading}>
              {loading ? '処理中...' : (isSignUp ? '新規登録' : 'ログイン')}
            </button>
          </form>
          <button onClick={() => setIsSignUp(!isSignUp)} className="text-btn">
            {isSignUp ? 'ログイン画面へ' : '新規登録画面へ'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="container main-app">
      <header className="app-header">
        <h2 className="logo">乗車記録</h2>
        <button onClick={() => supabase.auth.signOut()} className="icon-btn-logout"><LogOut size={18} /></button>
      </header>

      {activeTab === 'record' ? (
        <div className="card fade-in">
          <h3 className="section-title">
            {editingId ? <Edit2 size={18} /> : <PlusCircle size={18} />}
            <span>{editingId ? ' 記録を編集' : ' 新規乗車記録'}</span>
          </h3>
          <form onSubmit={handleSubmit} className="ride-form">
            <datalist id="company-list">{suggestions.companies.map(s => <option key={s} value={s} />)}</datalist>
            <datalist id="line-list">{suggestions.lines.map(s => <option key={s} value={s} />)}</datalist>
            <datalist id="service-list">{suggestions.services.map(s => <option key={s} value={s} />)}</datalist>
            <datalist id="station-list">{suggestions.stations.map(s => <option key={s} value={s} />)}</datalist>

            <div className="input-group">
              <label>日付<input style={{ width: '80%' }} type="date" value={formData.ride_date} onChange={(e) => handleInputChange('ride_date', e.target.value)} required /></label>
              <label>会社名<input type="text" list="company-list" placeholder="JR東日本" value={formData.railway_company} onChange={(e) => handleInputChange('railway_company', e.target.value)} /></label>
            </div>

            <div className="input-group">
              <input type="text" list="line-list" placeholder="路線名" value={formData.line_name} onChange={(e) => handleInputChange('line_name', e.target.value)} />
              <input type="text" list="service-list" placeholder="種別" value={formData.service_type} onChange={(e) => handleInputChange('service_type', e.target.value)} />
            </div>
            {/* 色の選択肢 + カスタムカラーピッカー */}
            <div>
              <div className="color-selector">
                {['bg-skyblue', 'bg-red', 'bg-orange', 'bg-green', 'bg-purple', 'bg-gray'].map(color => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot ${color} ${formData.service_color === color ? 'active' : ''}`}
                    onClick={() => setFormData({ ...formData, service_color: color })}
                  ></button>
                ))}

                {/* カスタムカラー選択 */}
                <div className="custom-color-wrapper">
                  <input
                    type="color"
                    id="customColor"
                    value={formData.service_color.startsWith('#') ? formData.service_color : '#cccccc'}
                    onChange={(e) => setFormData({ ...formData, service_color: e.target.value })}
                    className="custom-color-input"
                  />
                  <label htmlFor="customColor" className={`custom-color-label ${formData.service_color.startsWith('#') ? 'active' : ''}`}>
                    🎨
                  </label>
                </div>
              </div>
            </div>

            <div className="input-group">
              <input type="text" list="station-list" placeholder="行先" value={formData.destination} onChange={(e) => handleInputChange('destination', e.target.value)} />
              <input type="text" placeholder="車番/号車" value={formData.car_number} onChange={(e) => handleInputChange('car_number', e.target.value)} />
            </div>

            <div className="input-group-three">
              <input type="text" placeholder="列番" value={formData.train_number} onChange={(e) => handleInputChange('train_number', e.target.value)} />
              <input type="text" placeholder="運番" value={formData.operation_number} onChange={(e) => handleInputChange('operation_number', e.target.value)} />
              <input type="text" placeholder="編成" value={formData.formation_number} onChange={(e) => handleInputChange('formation_number', e.target.value)} />
            </div>

            <div className="input-group">
              <input type="text" list="station-list" placeholder="乗車駅" value={formData.departure_station} onChange={(e) => handleInputChange('departure_station', e.target.value)} />
              <input type="text" list="station-list" placeholder="下車駅" value={formData.arrival_station} onChange={(e) => handleInputChange('arrival_station', e.target.value)} />
            </div>
            <div className="input-group">
              <label>発時刻<input type="time" value={formData.departure_time} onChange={(e) => handleInputChange('departure_time', e.target.value)} style={{ width: '80%' }} /></label>
              <label>着時刻<input type="time" value={formData.arrival_time} onChange={(e) => handleInputChange('arrival_time', e.target.value)} style={{ width: '80%' }} /></label>
            </div>
            <textarea placeholder="備考・メモ" value={formData.memo} onChange={(e) => handleInputChange('memo', e.target.value)} />

            <div className="button-row" style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="primary submit-btn" style={{ flex: 2 }}>
                {editingId ? '変更を保存' : '記録を保存'}
              </button>
              {editingId && (
                <button type="button" onClick={handleCancelEdit} className="text-btn cancel-btn" style={{ flex: 1, textDecoration: 'none', background: '#eee', borderRadius: '12px', color: '#666', marginTop: 0 }}>
                  キャンセル
                </button>
              )}
            </div>
          </form>
        </div>
      ) : (
        <div className="fade-in">
          <div className="search-container card">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder={isCompact ? "" : "絞り込み..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
              style={{
                width: isCompact ? '0px' : '100%',
                padding: isCompact ? '0px' : '8px 12px',
                opacity: isCompact ? 0 : 1,
                marginLeft: isCompact ? '0px' : '8px'
              }}
            />
          </div>

          <div className="history-list">
            {Object.keys(groupedRides).length === 0 ? (
              <div className="empty-state">該当する記録がありません</div>
            ) : (
              Object.keys(groupedRides).sort((a, b) => b.localeCompare(a)).map(date => (
                <div key={date} className="history-date-group">
                  <div className="date-header">
                    <Calendar size={14} />
                    <span>{date.replace(/-/g, '/')}</span>
                    <span className="date-count">({groupedRides[date].length}件)</span>
                  </div>

                  {groupedRides[date].map(ride => (
                    <div key={ride.id} className="history-card card">
                      <div className="history-main">
                        <div className="history-time-col">
                          <div className="time-node">● {ride.departure_time?.slice(0, 5)}</div>
                          <div className="time-line"></div>
                          <div className="time-node">■ {ride.arrival_time?.slice(0, 5)}</div>
                        </div>
                        <div className="history-info-col">
                          <div className="info-top">
                            <span className="info-company">
                              {ride.railway_company}
                              <span className="info-line">{ride.line_name}</span>
                            </span>
                          </div>
                          <div className="info-middle">
                            <span
                              className={`badge ${!ride.service_color?.startsWith('#') ? (ride.service_color || getServiceColor(ride.service_type)) : ''}`}
                              style={ride.service_color?.startsWith('#') ? { backgroundColor: ride.service_color } : {}}
                            >
                              {/* 直接表示せずに関数を通す */}
                              {renderServiceType(ride.service_type)}
                            </span>
                            <span className="info-destination">
                              {ride.destination && <span> {ride.destination}</span>}
                            </span>
                          </div>
                          <div className="info-stations">
                            {ride.departure_station} <ChevronRight size={14} className="arrow-icon" /> {ride.arrival_station}
                          </div>
                          <div className="info-details">
                            {[ride.train_number, ride.formation_number, ride.car_number].filter(Boolean).join(' / ')}
                          </div>
                          {ride.memo && <div className="info-memo">{ride.memo}</div>}
                        </div>
                        <div className="action-btns">
                          <button onClick={() => handleDelete(ride.id)} className="delete-btn"><Trash2 size={16} /></button>
                          <button onClick={() => handleEditStart(ride)} className="edit-btn" style={{ background: 'none', border: 'none', color: '#0984e3', cursor: 'pointer', padding: '5px' }}><Edit2 size={16} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <button className={activeTab === 'record' ? 'active' : ''} onClick={() => setActiveTab('record')}>
          <PlusCircle size={24} /><span>記録</span>
        </button>
        <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
          <List size={24} /><span>履歴</span>
        </button>
      </nav>
    </div>
  )
}

export default App