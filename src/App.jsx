import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

function App() {
  const [news, setNews] = useState([]);
  const [socialHeadlines, setSocialHeadlines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('news');
  const [selectedSummary, setSelectedSummary] = useState(null); // Pour modal résumé
  // WallBot states
  const [chatMessages, setChatMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false); // Pour toggle widget
  // Translations & Feedback
  const [translatedText, setTranslatedText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  
  const anthropic = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true // For local dev; use backend in prod
  });
  const newsApiKey = '00146067546b42ae82be14857f12b5ea'; // Nouvelle clé API

  // LocalStorage helpers
  const CACHE_EXPIRATION = 60 * 60 * 1000; // 1 heure en ms
  const getCachedData = (key) => {
    const cached = localStorage.getItem(key);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRATION) return data;
    }
    return null;
  };
  const setCachedData = (key, data) => {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  };

  const fetchNews = async () => {
    const cacheKey = 'wallnews_news';
    const cachedNews = getCachedData(cacheKey);
    if (cachedNews) {
      setNews(cachedNews);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const countries = ['us', 'fr', 'gb'];
      const categories = ['science', 'science', 'general', 'health', 'business', 'general']; // Map: environment/science pour climate/space, general pour politics/big topic, health/tech, business pour crypto
      const categoryLabels = ['Climate Change', 'Space Exploration', 'Politique Internationale', 'Health Technology', 'Cryptocurrency', 'Biggest Topic of the Month'];
      const articles = [];
      
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const label = categoryLabels[i];
        let found = false;
        for (const country of countries) {
          const response = await axios.get(`https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&apiKey=${newsApiKey}`);
          let selectedArticle = response.data.articles[0]; // Fallback to first if no match
          const filtered = response.data.articles.filter(a => a.title && a.title.toLowerCase().includes(label.toLowerCase().split(' ')[0]));
          if (filtered.length > 0) {
            selectedArticle = filtered[0];
          }
          if (selectedArticle) {
            articles.push({...selectedArticle, customCategory: label});
            found = true;
          }
        }
        if (!found && articles.length < 6) {
          // Additional fallback if no article for category: use general search
          const fallbackResponse = await axios.get(`https://newsapi.org/v2/everything?q=${encodeURIComponent(label)}&apiKey=${newsApiKey}`);
          if (fallbackResponse.data.articles.length > 0) {
            articles.push({...fallbackResponse.data.articles[0], customCategory: label});
          }
        }
      }
      
      const uniqueArticles = articles.slice(0, 6); // Au moins 1 par catégorie, jusqu'à 6

      const prompt = `
        Analyse ces articles de news diversifiés (un par catégorie au moins) : ${JSON.stringify(uniqueArticles)}.
        Fournis au moins un article par catégorie (Climate Change, Space Exploration, Politique Internationale, Health Technology, Cryptocurrency, Biggest Topic of the Month) avec :
        - titre,
        - résumé objectif (basé sur plusieurs sources si possible),
        - sources multiples (ajoute opposants pour équilibrer les biais, comme indiqué dans le PDF : compléter avec notation de potentiel omission),
        - catégorie (du label fourni),
        - biasScore (nombre 0-10, 0=neutre ; basé sur intérêts politiques/financiers des sources et opposants, comme dans le PDF : identifier intérêts et compléter info ; calcule en plus via analyse RSS feeds pour patterns de word choice/omission),
        - vues/likes approximés (simule si absent),
        - url (lien original),
        - imageUrl (URL image si disponible, sinon vide).
        Format JSON strict : {articles: [{title, summary, sources: [], category, biasScore, views, likes, url, imageUrl}]}.
        Assure objectivité, diversification des points de vue, et combat des echo-chambers.
        Répondez UNIQUEMENT avec l'objet JSON valide. Commencez par { et terminez par }. N'incluez aucun autre texte, explication ou introduction.
      `;
      
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
      
      let resultText = response.content[0].text;
      // Extraction JSON si texte parasite
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) resultText = jsonMatch[0];
      
      let result;
      try {
        result = JSON.parse(resultText);
      } catch (parseErr) {
        console.error('Parsing error:', parseErr);
        setError('Réponse IA non valide (pas de JSON). Essayez de refresh.');
        return;
      }
      const processedNews = result.articles || [];
      setNews(processedNews);
      setCachedData(cacheKey, processedNews); // Cache
    } catch (err) {
      console.error('Error fetching/processing news:', err);
      setError('Échec du chargement.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSocial = async () => {
    const cacheKey = 'wallnews_social';
    const cachedSocial = getCachedData(cacheKey);
    if (cachedSocial) {
      setSocialHeadlines(cachedSocial);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`https://newsapi.org/v2/everything?q=trending+social+media&apiKey=${newsApiKey}`);
      const topics = response.data.articles.slice(0, 5);

      const prompt = `
        Analyse ces headlines de réseaux sociaux : ${JSON.stringify(topics)}.
        Fournis 5 topics majeurs avec :
        - titre,
        - résumé,
        - sources,
        - biasScore (nombre 0-10, basé sur intérêts politiques/financiers, comme dans le PDF ; calcule en plus via RSS pour word choice/omission).
        Format JSON : {topics: [{title, summary, sources: [], biasScore}]}.
        Focus sur trends sans biais utilisateur.
        Répondez UNIQUEMENT avec l'objet JSON valide. Commencez par { et terminez par }. N'incluez aucun autre texte, explication ou introduction.
      `;
      
      const aiResponse = await anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      
      let resultText = aiResponse.content[0].text;
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) resultText = jsonMatch[0];
      
      let result;
      try {
        result = JSON.parse(resultText);
      } catch (parseErr) {
        console.error('Parsing error:', parseErr);
        setError('Réponse IA non valide.');
        return;
      }
      const processedSocial = result.topics || [];
      setSocialHeadlines(processedSocial);
      setCachedData(cacheKey, processedSocial); // Cache
    } catch (err) {
      console.error('Error fetching social:', err);
      setError('Échec du chargement.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async (item) => {
    setLoading(true);
    try {
      const prompt = `
        Fournis un résumé détaillé objectif de cet article et ses sources : ${JSON.stringify(item)}.
        Inclu résumés multi-sources (ajoute opposants), biasScores (tableau de scores 0-10 pour chaque source, basé sur intérêts politiques/financiers comme dans le PDF ; calcule en plus via RSS pour patterns),
        links (tableau de liens).
        Invite à lire l'original pour se faire son avis.
        Format JSON strict : {detailedSummary: "texte résumé", sources: [], biasScores: [nombre, nombre, ...], links: []}.
        Répondez UNIQUEMENT avec l'objet JSON valide. Commencez par { et terminez par }. N'incluez aucun autre texte.
      `;
      
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });
      
      let resultText = response.content[0].text;
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) resultText = jsonMatch[0];
      
      const result = JSON.parse(resultText);
      setSelectedSummary(result);
    } catch (err) {
      console.error('Error fetching summary:', err);
      setError('Échec du résumé.');
    } finally {
      setLoading(false);
    }
  };

  // WallBot handler
  const handleWallBotSubmit = async () => {
    if (!userInput.trim()) return;
    
    setChatLoading(true);
    const newMessages = [...chatMessages, { role: 'user', content: userInput }];
    setChatMessages(newMessages);
    setUserInput('');
    
    try {
      const prompt = `
        Réponds à "${userInput}" UNIQUEMENT en listant des articles pertinents de sources différentes avec leurs liens et un résumé unique pour tous.
        Format JSON : {summary: "résumé unique pour tous les articles, avec biasScore global (0-10 basé sur PDF et RSS analysis)", articles: [{title: "titre", url: "lien"}]}.
        Liste au moins 3 articles, diversifiés. Invite à lire les complets pour se faire son avis.
        Répondez UNIQUEMENT avec l'objet JSON valide. Commencez par { et terminez par }. N'incluez aucun autre texte.
      `;
      
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });
      
      let resultText = response.content[0].text;
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) resultText = jsonMatch[0];
      
      const result = JSON.parse(resultText);
      let botResponse = `Résumé unique : ${result.summary || 'N/A'}\n\nArticles pertinents :\n`;
      (result.articles || []).forEach(a => {
        botResponse += `- Titre: ${a.title}\n  <button onclick="window.open('${a.url}', '_blank')" className="bg-blue-600 text-white px-2 py-1 rounded">Lire l'article</button>\n\n`;
      });
      botResponse += 'Lisez les articles complets pour vous faire votre propre avis.';
      setChatMessages([...newMessages, { role: 'bot', content: botResponse }]);
    } catch (err) {
      console.error('WallBot error:', err);
      setChatMessages([...newMessages, { role: 'bot', content: 'Erreur lors de la réponse.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Translation function (using Anthropic for demo; DeepL in prod)
  const translateArticle = async (text) => {
    try {
      const prompt = `
        Traduis ce texte en français : "${text}".
        Format JSON : {translation: "texte traduit"}.
        Répondez UNIQUEMENT avec l'objet JSON.
      `;
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-latest',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });
      const result = JSON.parse(response.content[0].text);
      setTranslatedText(result.translation);
    } catch (err) {
      console.error('Translation error:', err);
    }
  };

  // Feedback handler (simulated; in prod, send to backend)
  const handleFeedbackSubmit = () => {
    if (feedback.trim()) {
      // Simulate IA analysis (as per PDF: analyzed by teams, but IA for MVP)
      console.log('Feedback soumis :', feedback);
      setFeedbackSubmitted(true);
      setFeedback('');
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Chargement...</div>;
  }

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-500">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 w-full">
      <header className="bg-royal-blue shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                <span className="text-royal-blue font-bold text-lg">W</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">WallNews</h1>
                <p className="text-sm text-white/80">Real-Time Social & News Aggregator</p>
              </div>
            </div>
            <nav className="hidden md:flex space-x-6">
              {["News Articles", "Social Media"].map((n) => (
                <a key={n} href="#" className="text-white hover:text-light-blue px-3 py-2 rounded-md text-sm font-medium transition-colors">
                  {n}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex space-x-4 mb-8">
          <button 
            onClick={() => { setActiveTab('news'); fetchNews(); }} 
            className={`px-4 py-2 rounded font-medium ${activeTab === 'news' ? 'bg-light-blue text-white' : 'bg-royal-blue text-white hover:bg-light-blue'}`}
          >
            News Articles
          </button>
          <button 
            onClick={() => { setActiveTab('social'); fetchSocial(); }} 
            className={`px-4 py-2 rounded font-medium ${activeTab === 'social' ? 'bg-light-blue text-white' : 'bg-royal-blue text-white hover:bg-light-blue'}`}
          >
            Social Media
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-royal-blue">{activeTab === 'news' ? 'Latest News' : 'Social Headlines'}</h2>
                <button onClick={activeTab === 'news' ? fetchNews : fetchSocial} className="bg-royal-blue text-white hover:bg-light-blue px-4 py-2 rounded font-medium">Refresh</button>
              </div>
              <div className="space-y-6">
                {(activeTab === 'news' ? news : socialHeadlines).map((item, index) => (
                  <article key={index} className="border-b border-gray-100 pb-6 last:border-b-0">
                    {item.imageUrl && <img src={item.imageUrl} alt={item.title} className="w-full h-48 object-cover rounded mb-3" />}
                    <div className="flex items-center justify-between mb-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-light-blue text-white">{item.category || 'General'}</span>
                      <span className="text-sm text-gray-500">Just now</span>
                    </div>
                    <h3 className="text-lg font-semibold text-royal-blue mb-2 hover:text-light-blue cursor-pointer">{item.title}</h3>
                    <p className="text-gray-800 mb-3">{item.summary}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Sources: {item.sources.join(', ')}</span>
                      <span className="text-sm text-gray-500">Bias Score: {item.biasScore}</span>
                    </div>
                    <div className="flex space-x-4 text-sm text-gray-500">
                      <span>Views: {item.views || 'N/A'}</span>
                      <span>Likes: {item.likes || 'N/A'}</span>
                    </div>
                    <button onClick={() => fetchSummary(item)} className="text-royal-blue hover:text-light-blue text-sm font-medium">Read More (Résumé IA)</button>
                    <button onClick={() => translateArticle(item.summary)} className="text-royal-blue hover:text-light-blue text-sm font-medium ml-2">Traduire</button>
                    {translatedText && <p className="text-gray-800 mt-2">Traduction : {translatedText}</p>}
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-6">
            {/* Widget WallBot (rose de préférence) */}
            <div className="fixed bottom-4 right-4">
              {!isChatOpen && (
                <button onClick={() => setIsChatOpen(true)} className="bg-pink-500 text-white p-4 rounded-full shadow-lg">
                  Chat with WallBot
                </button>
              )}
              {isChatOpen && (
                <div className="bg-pink-100 rounded-xl shadow-lg p-4 w-80">
                  <div className="flex justify-between mb-2">
                    <h3 className="text-lg font-semibold">WallBot</h3>
                    <button onClick={() => setIsChatOpen(false)} className="text-pink-500">Fermer</button>
                  </div>
                  <div className="space-y-3 h-64 overflow-y-auto mb-4 bg-white p-2 rounded">
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-gray-100 text-right' : 'bg-pink-50 text-left'}`}>
                        <strong>{msg.role === 'user' ? 'Vous:' : 'WallBot:'}</strong>
                        <div dangerouslySetInnerHTML={{ __html: msg.content }} /> {/* Pour liens clickable */}
                      </div>
                    ))}
                    {chatLoading && <div>Chargement...</div>}
                  </div>
                  <div className="flex">
                    <input 
                      type="text" 
                      value={userInput} 
                      onChange={(e) => setUserInput(e.target.value)} 
                      className="flex-1 border rounded-l px-4 py-2" 
                      placeholder="Posez une question..." 
                    />
                    <button onClick={handleWallBotSubmit} className="bg-pink-600 text-white px-4 py-2 rounded-r">Envoyer</button>
                  </div>
                </div>
              )}
            </div>
            {/* Trending et AI Analysis statiques */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-royal-blue mb-4">Trending Topics</h3>
              <div className="space-y-3">
                {["Artificial Intelligence", "Climate Change", "Cryptocurrency", "Space Exploration", "Health Technology"].map((n) => (
                  <div key={n} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
                    <span className="font-medium text-royal-blue">{n}</span>
                    <span className="text-sm text-gray-500">↗</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-royal-blue mb-4">AI Analysis</h3>
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
                <p className="text-sm font-medium text-purple-900 mb-2">Today's News Sentiment</p>
                <div className="space-y-2">
                  {[
                    { label: "Positive", value: 65, color: "bg-green-500" },
                    { label: "Neutral", value: 25, color: "bg-gray-400" },
                    { label: "Negative", value: 10, color: "bg-red-500" }
                  ].map((n) => (
                    <div key={n.label} className="flex items-center space-x-3">
                      <span className="text-xs font-medium text-gray-700 w-16">{n.label}</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div className={`${n.color} h-2 rounded-full transition-all duration-300`} style={{ width: `${n.value}%` }}></div>
                      </div>
                      <span className="text-xs font-medium text-gray-700">{n.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Feedback Form */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-royal-blue mb-4">Feedback</h3>
              {!feedbackSubmitted ? (
                <div>
                  <textarea 
                    value={feedback} 
                    onChange={(e) => setFeedback(e.target.value)} 
                    className="w-full border p-2 rounded mb-2" 
                    placeholder="Votre feedback..." 
                  />
                  <button onClick={handleFeedbackSubmit} className="bg-royal-blue text-white hover:bg-light-blue px-4 py-2 rounded">Soumettre</button>
                </div>
              ) : (
                <p className="text-green-600">Feedback soumis ! Merci.</p>
              )}
            </div>
          </div>
        </div>
      </main>
      {/* Modal pour résumé */}
      {selectedSummary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded shadow-lg max-w-lg">
            <h3 className="text-lg font-bold text-royal-blue mb-2">Résumé Détailé IA</h3>
            <p className="text-gray-800">{selectedSummary.detailedSummary}</p>
            <p className="text-gray-800">Sources: {selectedSummary.sources.join(', ')}</p>
            <p className="text-gray-800">Biais Scores: {selectedSummary.biasScores.join(', ')}</p>
            <p className="text-gray-800">Liens: {selectedSummary.links.map((link, idx) => <a key={idx} href={link} target="_blank" rel="noopener noreferrer" className="text-royal-blue hover:text-light-blue">Lien {idx + 1}</a>)}</p>
            <button onClick={() => setSelectedSummary(null)} className="mt-4 bg-royal-blue text-white hover:bg-light-blue px-4 py-2 rounded">Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;