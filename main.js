var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
const CryptoJS = require("crypto-js");
const fetch = require('node-fetch');
const fs = require('fs');
const { json } = require('stream/consumers');

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
  ['Rock','Rock','Rock','Rock','Rock','Rock','Rock','Rock'],
  ['Paper','Paper','Paper','Paper','Paper','Paper','Paper','Paper'],
  ['Scissors','Scissors','Scissors','Scissors','Scissors','Scissors','Scissors','Scissors']
],'cards':[],'gold':0}
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
        break
      }
      if (client.id == game.player2.id){
        io.to(game.player1.id).emit('victory','forfeit')
        rooms.splice(i,1)
        console.log(`${client.username} disconnected, so ${game.player1.name} wins!`)
        break
      }
    }
    i = 0
    for (waiting of searching) {
      if(waiting.id == client.id){
        console.log('Loser Left')
      }
    }
  })
  client.on('register',function(username,password,callback){
    var dbdata = JSON.parse(fs.readFileSync('users.txt','utf8'))
    var taken = false
    dbdata.users.forEach(user => {
      if(user.username == username){
        taken = true
      }
    });
    if (taken){
      callback(false,undefined)
    } else {
      callback(true,encrypt(username))
      dbdata.users.push({"username":username,"password":password,"userdata":startingGoods})
      fs.writeFileSync('users.txt',JSON.stringify(dbdata))
    }
  })
  client.on('login',function(username,password,callback){
    var dbdata = JSON.parse(fs.readFileSync('users.txt','utf8'))
    var matched = false
    for (user of dbdata.users) {
      if(user.username == username){
        if(user.password == password){
          matched = true
          console.log('User logged in.')
        }
      }
    }
    if (matched){
      callback(true,encrypt(username))
    } else {
      callback(false,undefined)
      console.log('Log in failed.')
    }
  })
  client.on('auth',function(id,callback){
    var dbdata = JSON.parse(fs.readFileSync('users.txt','utf8'))
    var found = false
    for (user of dbdata.users) {
      if(user.username == decrypt(id)){
        found = true
        callback(true,JSON.stringify(user.userdata),JSON.stringify(cards))
        console.log('User Authenticated: '+user.username)
        client.username = user.username
        client.userdata = user.userdata
        playersockets.set(client.id,client)
        break
      }
    }
    if(!found){
      callback(false,undefined)
      console.log('Attempted User Authentication Failed.')
    }
  })
  client.on('searching',function(deck){
    console.log(client.username+' is searching for a match.')
    var shuffled = []
    deck.forEach((stack) => {
      shuffled.push(shuffle(stack))
    })
    searching.push({'id':client.id,'name':client.username,'deck':shuffled})
  })
  client.on('save',() => {

  })
})

//Game Stuff
function tickSec(){
  if (searching.length >= 2){
    var player1 = searching.splice(Math.floor(Math.random()*searching.length),1)[0]
    var player2 = searching.splice(Math.floor(Math.random()*searching.length),1)[0]
    if(player1.id!==player2.id){
      //Start Game
      player1.card = undefined
      player2.card = undefined
      player1.hp = 25
      player2.hp = 25
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
      if(cards[player1.card].win.includes(player2.card)){
        player2.hp-=5
        console.log(`${player1.card} beats ${player2.card}`)
      }
      if(cards[player2.card].win.includes(player1.card)){
        player1.hp-=5
        console.log(`${player2.card} beats ${player1.card}`)
      }
      if(player1.hp<=0){
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
    if(player1.hp>=0 && player2.hp>=0){
      rooms[roomdex].player1 = player1
      rooms[roomdex].player2 = player2
      roomdex++
    }else{
      console.log('Got here!')
      
      winner.userdata.gold+=100
      save(winner.username,winner.userdata)
      rooms.splice(roomdex,1)
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
  'Rope':{'desc':'Rope is handy and flexible, as long as it doesn\'t get cut.','win':['Rock','Paper'],'lose':['Scissors'],'sfx':noFX}
}

//Manage Save Data
function save(username,userdata){
  var dbdata = JSON.parse(fs.readFileSync('users.txt','utf8'))
  var users = dbdata.users
  for (i in dbdata) {
    if(dbdata[i].username==username){
      dbdata[i].userdata = userdata
      fs.writeFileSync('users.txt',JSON.stringify(dbdata))
      console.log('Data Saved')
      break
    }
  }
}

//Start The Server
server.listen(3000)
console.log(new Date(Date.now()).toString())
var dbdata = JSON.parse(fs.readFileSync('users.txt','utf8'))
console.log(JSON.stringify(dbdata))
tickSec()
runGames()