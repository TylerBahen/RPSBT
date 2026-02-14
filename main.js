var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
const CryptoJS = require("crypto-js");
const fetch = require('node-fetch');
const fs = require('fs');
const { json } = require('stream/consumers');

const { createClient } = require('@supabase/supabase-js')


const supabaseUrl = 'https://mmpaphmwjcrunggplqbk.supabase.co'
const supabaseKey = 'sb_publishable_kuhDVNZK1UIrhjxsZ-8org_I1J3dLRv'

const supabase = createClient(supabaseUrl, supabaseKey)

async function saveObject(id, json) {
  const { data, error } = await supabase
    .from('objects')
    .upsert({ id, data: json })

  if (error) throw error
  return data
}
async function loadObject(id) {
  const { data, error } = await supabase
    .from('objects')
    .select('data')
    .eq('id', id)
    .maybeSingle()   // <— important

  if (error) throw error
  return data ? data.data : null
}
async function deleteObject(id) {
  const { error } = await supabase
    .from('objects')
    .delete()
    .eq('id', id)

  if (error) throw error
}
const db = {
  async get(id) {
    return await loadObject(id)
  },
  async set(id, json) {
    return await saveObject(id, json)
  },
  async delete(id) {
    return await deleteObject(id)
  }
}


const encrypt = (text) => {
  return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(text));
};

const decrypt = (data) => {
  return CryptoJS.enc.Base64.parse(data).toString(CryptoJS.enc.Utf8);
};

async function fetchData(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return response.json();
  } catch (error) {
    console.error('Unable to fetch data:', error);
  }
}

//GETs and Responses
app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
})
app.get('/signup',function(req,res) {
  res.sendFile(__dirname + '/signup.html');
})
app.get('/login',function(req,res) {
  res.sendFile(__dirname + '/login.html');
  console.log('User logging in...')
})
app.get('/play',function(req,res) {
  res.sendFile(__dirname + '/game.html');
})


var rooms = []
var playersockets = new Map()
var searching = []
const startingGoods = {deck:[
  ['Rock','Rock','Rock','Rock','Rock','Rock'],
  ['Paper','Paper','Paper','Paper','Paper','Paper'],
  ['Scissors','Scissors','Scissors','Scissors','Scissors','Scissors']
],'cards':[],'gold':1900}
//Handling Connections and Events
io.on('connection',function(client){
  client.emit('ioconnect')
  client.on('disconnect',function(){
    playersockets.delete(client.id)
    var i = 0
    for (var game of rooms) {
      if(client.id == game.player1.id){
        io.to(game.player2.id).emit('victory','forfeit')
        rooms.splice(i,1)
        console.log(`${client.username} disconnected, so ${game.player2.name} wins!`)
        var winner = playersockets.get(game.player2.id)
        winner.userdata.gold+=100
        save(winner.username,winner.userdata)
        break
      }
      if (client.id == game.player2.id){
        io.to(game.player1.id).emit('victory','forfeit')
        rooms.splice(i,1)
        console.log(`${client.username} disconnected, so ${game.player1.name} wins!`)
        var winner = playersockets.get(game.player1.id)
        winner.userdata.gold+=100
        save(winner.username,winner.userdata)
        break
      }
    }
    i = 0
    for (waiting of searching) {
      if(waiting.id == client.id){
        console.log('Player Left Matchmaking')
        searching.splice(i,1)
        break
      }
      i++
    }
  })
  client.on('register',function(username,password,callback){
    db.get(username).then((dbuser) => {
    if(dbuser!=null){
      callback(false,undefined)
    } else {
      callback(true,encrypt(username))
      db.set(username,{"username":username,"password":password,"userdata":startingGoods})
      console.log('Created new user: '+username)
    }
    })
  })
  client.on('login',function(username,password,callback){
    db.get(username).then((dbuser) => {
      console.log(dbuser.password)
      if (dbuser.password==password){
        callback(true,encrypt(username))
        console.log('User logged in.')
      } else {
        callback(false,undefined)
        console.log('Log in failed.')
      }
    })
  })
  client.on('auth',function(id,callback){
    var username = decrypt(id)
    db.get(username).then((dbuser) => {
      if(dbuser!=null){
        callback(true,JSON.stringify(dbuser.userdata),JSON.stringify(cards))
        console.log('User Authenticated: '+dbuser.username)
        client.username = dbuser.username
        client.userdata = dbuser.userdata
        playersockets.set(client.id,client)
    } else {
      callback(false,undefined)
      console.log('Attempted User Authentication Failed.')
    }
    })
  })
  client.on('searching',function(deck){
    if(client.userdata==undefined){
      client.emit('reauth')
    } else {
      console.log(client.username+' is searching for a match.')
      var shuffled = []
      deck.forEach((stack) => {
        shuffled.push(shuffle(stack))
      })
      searching.push({'id':client.id,'name':client.username,'deck':shuffled})
    }
  })
  client.on('save',(deck,bank) => {
    if(client.userdata!=undefined){
      save(client.username,{"deck":deck,"cards":bank,"gold":client.userdata.gold})
    }else{
      client.emit('reauth')
    }
  })
  client.on('purchase',(purchase,callback) => {
    if(client.userdata==undefined){
      client.emit('reauth')
    }else{
      switch(purchase){
        case 'commonpack':
          if(client.userdata.gold>=1000){
            var pulls = [
              randomFrom(commons),
              randomFrom(commons),
              randomFrom(commons)
            ]
            client.userdata.cards.push(...pulls)
            client.userdata.gold-=1000
            save(client.username,client.userdata)
            callback(pulls)
          } else {
            client.emit('msg','Not enough gold!')
          }
      }
    }
  })
  client.on('balance',(callback) => {
    if(client.userdata==undefined){
      client.emit('reauth')
    } else {
      callback(client.userdata.gold)
    }
  })
})

//Game Stuff
function tickSec(){
  if (searching.length >= 2){
    var player1 = searching.splice(Math.floor(Math.random()*searching.length),1)[0]
    var player2 = searching.splice(Math.floor(Math.random()*searching.length),1)[0]
    if(player1.name!==player2.name){
      //Start Game
      player1.card = undefined
      player2.card = undefined
      player1.hp = 25
      player2.hp = 25
      player1.message = 'Opponent Found'
      player2.message = 'Opponent Found'
      rooms.push({'player1':player1,'player2':player2})
      console.log("Match Found!")
      console.log(player1.name+' vs. '+player2.name)
      io.to(player1.id).emit('gamestart',JSON.stringify(player1),JSON.stringify(player2))
      io.to(player2.id).emit('gamestart',JSON.stringify(player2),JSON.stringify(player1))
    } else {
      searching.push(player1)
      console.log('Error, Same User')
    }
  }
  setTimeout(tickSec,1000)
}

function runGames(){
  var roomdex = 0
  rooms.forEach((game) => {
    var player1 = game.player1
    var player2 = game.player2
    if(player1.card==undefined){
      playersockets.get(player1.id).emit('playreq',(card,number) => {
        if(card!=undefined){
          player1.card = card
          player1.cardnum = number
        }
      })
    }
    if(player2.card==undefined){
      playersockets.get(player2.id).emit('playreq',(card,number) => {
        if(card!=undefined){
          player2.card = card
          player2.cardnum = number
        }
      })
    }
    if(player1.card!=undefined && player2.card!=undefined){
      //Run Round
      player1.message = 'It is a tie!'
      player2.message = 'It is a tie!'
      if(cards[player1.card].win.includes(player2.card)){
        player2.hp-=5
        player1.message = `${player1.card} beats ${player2.card}`
        player2.message = `${player1.card} beats ${player2.card}`
      }
      if(cards[player2.card].win.includes(player1.card)){
        player1.hp-=5
        player1.message = `${player2.card} beats ${player1.card}`
        player2.message = `${player2.card} beats ${player1.card}`
      }
      //[player1,player2] = cards[player1.card].sfx(player1,player2)
      //[player2,player1] = cards[player2.card].sfx(player2,player1)
      const [p1a, p2a] = cards[player1.card].sfx(player1, player2)
      player1 = p1a
      player2 = p2a

      const [p2b, p1b] = cards[player2.card].sfx(player2, player1)
      player2 = p2b
      player1 = p1b
      if(player1.hp<=0 && player2.hp<=0){
        io.to(player1.id).emit('defeat','tie')
        io.to(player2.id).emit('defeat','tie')
        winner = null
      } else if(player1.hp<=0){
        io.to(player2.id).emit('victory','normal')
        io.to(player1.id).emit('defeat','normal')
        var winner = playersockets.get(player2.id)
      }else if(player2.hp<=0){
        io.to(player1.id).emit('victory','normal')
        io.to(player2.id).emit('defeat','normal')
        var winner = playersockets.get(player1.id)
      } else {
        player1.deck[player1.cardnum].push(player1.deck[player1.cardnum].shift())
        player2.deck[player2.cardnum].push(player2.deck[player2.cardnum].shift())
        io.to(player1.id).emit('moved',JSON.stringify(player1),JSON.stringify(player2))
        io.to(player2.id).emit('moved',JSON.stringify(player2),JSON.stringify(player1))
      }
      player1.card = undefined
      player2.card = undefined
    }
    if(player1.hp>0 && player2.hp>0){
      rooms[roomdex].player1 = player1
      rooms[roomdex].player2 = player2
      roomdex++
    }else{
      rooms.splice(roomdex,1)
      if(winner!=null){
        winner.userdata.gold+=100
        save(winner.username,winner.userdata)
      }
    }
  })
  setTimeout(runGames,3000)
}
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}


function noFX(ap,nap){
  return [ap,nap]
}
//Card Data
var cards = {
  'Rock':{'desc':'One of the original three. Beats scissors and loses to paper.','win':['Scissors','Ace of Spades','Ice'],'lose':['Paper'],'sfx':noFX},
  'Paper':{'desc':'One of the original three. Beats rock and looses to scissors.','win':['Rock','Ace of Spades','Magnet'],'lose':['Scissors'],'sfx':noFX},
  'Scissors':{'desc':'One of the original three. Beats paper and loses to rock','win':['Paper','Ace of Spades','Rope'],'lose':['Rock'],'sfx':noFX},
  'Ace of Spades':{'desc':'The death card. Only loses to rock, paper, or scissors.','win':['Ice','Magnet','Rope'],'lose':['Rock','Paper','Scissors'],'sfx':noFX},
  'Ice':{'desc':'Ice is pretty tough, until it melts or gets smashed.','win':['Scissors','Paper'],'lose':['Rock'],'sfx':noFX},
  'Magnet':{'desc':'Magnets are super cool! Too bad they only work on metal.','win':['Rock','Scissors'],'lose':['Paper'],'sfx':noFX},
  'Rope':{'desc':'Rope is handy and flexible, as long as it doesn\'t get cut.','win':['Rock','Paper'],'lose':['Scissors'],'sfx':noFX},
  'Flashlight':{'desc':'Flashlights help you see things that are hard to see. Using it shows your opponent\'s hand.','win':[],'lose':[],'sfx':function(ap,nap){ap.message+='<br>With your flashlight, you see your opponent\'s hand!'; ap.message+=`<br>Currently they have:<br>${nap.deck[0][0]}<br>${nap.deck[1][0]}<br>${nap.deck[2][0]}`; nap.message+='<br>Your opponent saw your hand!'; return [ap,nap]}},
  'Eye':{'desc':'The eye grants you vision and allows you to see your opponent\'s hand for the rest of the game.','win':[],'lose':[],'sfx':function(ap,nap){ap.vision = true; ap.message+='<br>The eye grants you vision.'; return [ap,nap]}}
}
function randomFrom(list){
  return list[Math.floor(Math.random()*list.length)]
}
var junks = [
  'Rock','Rock','Rock','Rock','Rock',
  'Paper','Paper','Paper','Paper','Paper',
  'Scissors','Scissors','Scissors','Scissors','Scissors',
  'Ice','Magnet','Rope'
]
var commons = [
  'Ice',
  'Magnet',
  'Rope',
  'Flashlight'
]
var rares = [
  
]

//Manage Save Data
function save(username,userdata){
  db.set(username,userdata)
  console.log('Saved userdata for '+username)
}

//Start The Server
server.listen(3000)
console.log(new Date(Date.now()).toString())
tickSec()
runGames()