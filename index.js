const { Client, GatewayIntentBits, Events, Collection, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 봇 설정
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 설정 변수
const PREFIX = '!';
const TOKEN = "ENTER-YOUR-BOT's-TOKEN"; // 봇 토큰을 여기에 입력하세요

// DB 디렉토리 설정
const DB_PATH = path.join(__dirname, 'DB');
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH);
}

// 서버별 데이터 관리 함수
function getUserData(guildId, userId) {
  // 서버 디렉토리 확인 및 생성
  const guildPath = path.join(DB_PATH, guildId);
  if (!fs.existsSync(guildPath)) {
    fs.mkdirSync(guildPath, { recursive: true });
  }
  
  // 사용자 파일 경로
  const userPath = path.join(guildPath, `${userId}.json`);
  
  // 사용자 데이터가 없으면 기본값으로 생성
  if (!fs.existsSync(userPath)) {
    const defaultData = { balance: 0 };
    fs.writeFileSync(userPath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  
  // 사용자 데이터 읽기
  try {
    return JSON.parse(fs.readFileSync(userPath));
  } catch (error) {
    console.error(`Error reading user data for ${userId} in guild ${guildId}:`, error);
    const defaultData = { balance: 0 };
    fs.writeFileSync(userPath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
}

// 데이터 저장 함수
function saveUserData(guildId, userId, userData) {
  const guildPath = path.join(DB_PATH, guildId);
  if (!fs.existsSync(guildPath)) {
    fs.mkdirSync(guildPath, { recursive: true });
  }
  
  const userPath = path.join(guildPath, `${userId}.json`);
  try {
    fs.writeFileSync(userPath, JSON.stringify(userData, null, 2));
  } catch (error) {
    console.error(`Error saving user data for ${userId} in guild ${guildId}:`, error);
  }
}

// 잔액 업데이트 함수
function updateBalance(guildId, userId, amount) {
  const userData = getUserData(guildId, userId);
  userData.balance += amount;
  saveUserData(guildId, userId, userData);
  return userData.balance;
}

// 슬래시 명령어 등록
const commands = [
  new SlashCommandBuilder()
    .setName('도박')
    .setDescription('일정 금액을 걸고 도박을 합니다')
    .addIntegerOption(option => 
      option.setName('금액')
        .setDescription('도박에 걸 금액')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('돈줘')
    .setDescription('기본 금액을 받습니다 (1시간에 한 번)'),
  
  new SlashCommandBuilder()
    .setName('잔액확인')
    .setDescription('현재 잔액을 확인합니다'),
  
  new SlashCommandBuilder()
    .setName('관리자')
    .setDescription('관리자 명령어')
    .addSubcommand(subcommand =>
      subcommand
        .setName('돈지급')
        .setDescription('사용자에게 돈을 지급합니다')
        .addUserOption(option => option.setName('사용자').setDescription('돈을 지급할 사용자').setRequired(true))
        .addIntegerOption(option => option.setName('금액').setDescription('지급할 금액').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('돈차감')
        .setDescription('사용자의 돈을 차감합니다')
        .addUserOption(option => option.setName('사용자').setDescription('돈을 차감할 사용자').setRequired(true))
        .addIntegerOption(option => option.setName('금액').setDescription('차감할 금액').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('잔액확인')
        .setDescription('사용자의 잔액을 확인합니다')
        .addUserOption(option => option.setName('사용자').setDescription('잔액을 확인할 사용자').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  // 핑 명령어 추가
  new SlashCommandBuilder()
    .setName('핑')
    .setDescription('봇의 핑 상태를 확인합니다')
];

// cooldown 관리 (돈줘 명령어용)
const cooldowns = new Map();

// 봇이 준비되었을 때
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  // 슬래시 명령어 등록
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('슬래시 명령어 등록 중...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('슬래시 명령어 등록 완료!');
  } catch (error) {
    console.error(error);
  }
});

// 슬래시 명령어 처리
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isCommand()) return;
  
  const { commandName, options, guildId, user } = interaction;
  
  // 서버가 아닌 곳에서 사용 시 에러 메시지 (핑 명령어는 제외)
  if (!guildId && commandName !== '핑') {
    return interaction.reply({ content: '이 명령어는 서버에서만 사용할 수 있습니다.', ephemeral: true });
  }

  try {
    switch(commandName) {
      case '도박':
        await handleGamble(interaction, options.getInteger('금액'));
        break;
      case '돈줘':
        await handleGiveMoney(interaction);
        break;
      case '잔액확인':
        await handleCheckBalance(interaction);
        break;
      case '관리자':
        const subcommand = options.getSubcommand();
        const targetUser = options.getUser('사용자');
        const amount = options.getInteger('금액');
        
        if (subcommand === '돈지급') {
          await handleAdminAddMoney(interaction, targetUser, amount);
        } else if (subcommand === '돈차감') {
          await handleAdminRemoveMoney(interaction, targetUser, amount);
        } else if (subcommand === '잔액확인') {
          await handleAdminCheckBalance(interaction, targetUser);
        }
        break;
      case '핑':
        await handlePing(interaction);
        break;
    }
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '명령어 실행 중 오류가 발생했습니다.', ephemeral: true });
    } else {
      await interaction.reply({ content: '명령어 실행 중 오류가 발생했습니다.', ephemeral: true });
    }
  }
});

// 텍스트 명령어 (prefix) 처리
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  
  const args = message.content.slice(PREFIX.length).split(" ");
  const command = args.shift().toLowerCase();
  
  // 서버가 아닌 곳에서 사용 시 무시 (핑 명령어는 제외)
  if (!message.guild && command !== '핑') return;
  
  try {
    switch(command) {
      case 'ㄷㅂ':
        betAmount = parseInt(args[0]);
        if (isNaN(betAmount) || betAmount <= 0) {
          return message.reply('올바른 금액을 입력해주세요.');
        }
        await handleGambleText(message, betAmount);
        break;
      case '도박':
        betAmount = parseInt(args[0]);
        if (isNaN(betAmount) || betAmount <= 0) {
          return message.reply('올바른 금액을 입력해주세요.');
        }
        await handleGambleText(message, betAmount);
        break;
      case '돈줘':
        await handleGiveMoneyText(message);
        break;
      case 'ㄷㅈ':
        await handleGiveMoneyText(message);
        break;
      case '잔액확인':
        await handleCheckBalanceText(message);
        break;
      case '잔액':
        await handleCheckBalanceText(message);
        break;
      case 'ㅈㅇ':
        await handleCheckBalanceText(message);
        break;
      case '관리자':
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return message.reply('이 명령어는 관리자만 사용할 수 있습니다.');
        }
        
        const subCommand = args[0];
        
        if (!subCommand) {
          return message.reply('올바른 서브 명령어를 입력해주세요. (`돈지급`, `돈차감`, `잔액확인`)');
        }
        
        switch(subCommand) {
          case '돈지급':
            const addUser = message.mentions.users.first();
            const addAmount = parseInt(args[2]);
            
            if (!addUser || isNaN(addAmount) || addAmount <= 0) {
              return message.reply('올바른 사용자와 금액을 입력해주세요. (`!관리자 돈지급 @사용자 금액`)');
            }
            
            await handleAdminAddMoneyText(message, addUser, addAmount);
            break;
          case '돈차감':
            const removeUser = message.mentions.users.first();
            const removeAmount = parseInt(args[2]);
            
            if (!removeUser || isNaN(removeAmount) || removeAmount <= 0) {
              return message.reply('올바른 사용자와 금액을 입력해주세요. (`!관리자 돈차감 @사용자 금액`)');
            }
            
            await handleAdminRemoveMoneyText(message, removeUser, removeAmount);
            break;
          case '잔액확인':
            const checkUser = message.mentions.users.first();
            
            if (!checkUser) {
              return message.reply('올바른 사용자를 지정해주세요. (`!관리자 잔액확인 @사용자`)');
            }
            
            await handleAdminCheckBalanceText(message, checkUser);
            break;
          default:
            message.reply('올바른 서브 명령어를 입력해주세요. (`돈지급`, `돈차감`, `잔액확인`)');
        }
        break;
      case '핑':
        await handlePingText(message);
        break;
    }
  } catch (error) {
    console.error(error);
    message.reply('명령어 실행 중 오류가 발생했습니다.');
  }
});

// 명령어 처리 함수 (슬래시 명령어)
async function handleGamble(interaction, amount) {
  const { guildId, user } = interaction;
  const userData = getUserData(guildId, user.id);
  
  if (userData.balance < amount) {
    return interaction.reply({ content: `도박에 참여하기 위한 금액이 부족합니다. 현재 잔액: ${userData.balance}`, ephemeral: true });
  }
  
  // 50% 확률로 승리 또는 패배
  const win = Math.random() >= 0.75;
  let winAmount = 0;
  
  if (win) {
    winAmount = amount*2;
    updateBalance(guildId, user.id, winAmount);
    return interaction.reply(`🎉 축하합니다! ${amount}원을 얻었습니다. 현재 잔액: ${userData.balance + winAmount}원`);
  } else {
    winAmount = -amount;
    updateBalance(guildId, user.id, winAmount);
    return interaction.reply(`😢 아쉽게도 ${amount}원을 잃었습니다. 현재 잔액: ${userData.balance + winAmount}원`);
  }
}

async function handleGiveMoney(interaction) {
  const { guildId, user } = interaction;
  const now = Date.now();
  const cooldownKey = `${guildId}-${user.id}`;
  const cooldownAmount = 3600000; // 1시간 (밀리초)
  const giveAmount = 1000; // 지급할 금액
  
  if (cooldowns.has(cooldownKey)) {
    const expirationTime = cooldowns.get(cooldownKey) + cooldownAmount;
    
    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000 / 60 ;
      const left = timeLeft.toFixed(0);
      return interaction.reply({ 
        content: `돈은 1시간에 한 번만 받을 수 있습니다. ${left}분 후 에 다시 시도해주세요.`, 
        ephemeral: true 
      });
    }
  }
  
  cooldowns.set(cooldownKey, now);
  const newBalance = updateBalance(guildId, user.id, giveAmount);
  
  return interaction.reply(`💰 ${giveAmount}원을 받았습니다! 현재 잔액: ${newBalance}원`);
}

async function handleCheckBalance(interaction) {
  const { guildId, user } = interaction;
  const userData = getUserData(guildId, user.id);
  
  return interaction.reply({ content: `현재 잔액: ${userData.balance}원`, ephemeral: true });
}

// 핑 명령어 처리 함수 (슬래시)
async function handlePing(interaction) {
  // 응답 지연 시간 측정을 위해 deferred 응답 후 측정
  const sent = await interaction.deferReply({ fetchReply: true });
  
  // WebSocket 핑 (클라이언트 <-> 디스코드 서버 간 지연 시간)
  const wsLatency = client.ws.ping;
  
  // API 응답 지연 시간 (명령어 응답 시간)
  const apiLatency = sent.createdTimestamp - interaction.createdTimestamp;
  
  await interaction.editReply(
    `🏓 퐁!\n⌛ WebSocket 핑: ${wsLatency}ms\n⏱️ API 핑: ${apiLatency}ms`
  );
}

async function handleAdminAddMoney(interaction, targetUser, amount) {
  const { guildId } = interaction;
  const newBalance = updateBalance(guildId, targetUser.id, amount);
  
  return interaction.reply({ 
    content: `${targetUser.tag}에게 ${amount}원을 지급했습니다. 해당 사용자의 새로운 잔액: ${newBalance}원`, 
    ephemeral: true 
  });
}

async function handleAdminRemoveMoney(interaction, targetUser, amount) {
  const { guildId } = interaction;
  const userData = getUserData(guildId, targetUser.id);
  
  if (userData.balance < amount) {
    return interaction.reply({ 
      content: `${targetUser.tag}님의 잔액이 부족합니다. 현재 잔액: ${userData.balance}원`, 
      ephemeral: true 
    });
  }
  
  const newBalance = updateBalance(guildId, targetUser.id, -amount);
  
  return interaction.reply({ 
    content: `${targetUser.tag}에게서 ${amount}원을 차감했습니다. 해당 사용자의 새로운 잔액: ${newBalance}원`, 
    ephemeral: true 
  });
}

async function handleAdminCheckBalance(interaction, targetUser) {
  const { guildId } = interaction;
  const userData = getUserData(guildId, targetUser.id);
  
  return interaction.reply({ 
    content: `${targetUser.tag}님의 현재 잔액: ${userData.balance}원`, 
    ephemeral: true 
  });
}

// 명령어 처리 함수 (텍스트 명령어)
async function handleGambleText(message, amount) {
  const { guildId, author } = message;
  const userData = getUserData(guildId, author.id);
  
  if (userData.balance < amount) {
    return message.reply(`도박에 참여하기 위한 금액이 부족합니다. 현재 잔액: ${userData.balance}`);
  }
  
  // 50% 확률로 승리 또는 패배
  const win = Math.random() >= 0.75;
  let winAmount = 0;
  
  if (win) {
    winAmount = amount*2;
    updateBalance(guildId, author.id, winAmount);
    return message.reply(`:\) 축하합니다! ${amount}원을 얻었습니다. 현재 잔액: ${userData.balance + winAmount}원`);
  } else {
    winAmount = -amount;
    updateBalance(guildId, author.id, winAmount);
    return message.reply(`:\( 아쉽게도 ${amount}원을 잃었습니다. 현재 잔액: ${userData.balance + winAmount}원`);
  }
}

async function handleGiveMoneyText(message) {
  const { guildId, author } = message;
  const now = Date.now();
  const cooldownKey = `${guildId}-${author.id}`;
  const cooldownAmount = 3600000; // 1일 (밀리초)
  const giveAmount = 1000; // 지급할 금액
  
  if (cooldowns.has(cooldownKey)) {
    const expirationTime = cooldowns.get(cooldownKey) + cooldownAmount;
    
    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000 / 60 ;
      return message.reply(`돈은 1시간에 한 번만 받을 수 있습니다. ${timeLeft.toFixed(1)}분 후 에 다시 시도해주세요.`);
    }
  }
  
  cooldowns.set(cooldownKey, now);
  const newBalance = updateBalance(guildId, author.id, giveAmount);
  
  return message.reply(`💰 ${giveAmount}원을 받았습니다! 현재 잔액: ${newBalance}원`);
}

async function handleCheckBalanceText(message) {
  const { guildId, author } = message;
  const userData = getUserData(guildId, author.id);
  
  return message.reply(`현재 잔액: ${userData.balance}원`);
}

// 핑 명령어 처리 함수 (텍스트)
async function handlePingText(message) {
  // 메시지 보내고 응답 시간 측정
  const timeBefore = Date.now();
  const pingMessage = await message.channel.send('핑 측정 중...');
  
  // WebSocket 핑 (클라이언트 <-> 디스코드 서버 간 지연 시간)
  const wsLatency = client.ws.ping;
  
  // API 응답 지연 시간 (메시지 응답 시간)
  const apiLatency = Date.now() - timeBefore;
  
  await pingMessage.edit(
    `🏓 퐁!\n⌛ WebSocket 핑: ${wsLatency}ms\n⏱️ API 핑: ${apiLatency}ms`
  );
}

async function handleAdminAddMoneyText(message, targetUser, amount) {
  const { guildId } = message;
  const newBalance = updateBalance(guildId, targetUser.id, amount);
  
  return message.reply(`${targetUser.tag}에게 ${amount}원을 지급했습니다. 해당 사용자의 새로운 잔액: ${newBalance}원`);
}

async function handleAdminRemoveMoneyText(message, targetUser, amount) {
  const { guildId } = message;
  const userData = getUserData(guildId, targetUser.id);
  
  if (userData.balance < amount) {
    return message.reply(`${targetUser.tag}님의 잔액이 부족합니다. 현재 잔액: ${userData.balance}원`);
  }
  
  const newBalance = updateBalance(guildId, targetUser.id, -amount);
  
  return message.reply(`${targetUser.tag}에게서 ${amount}원을 차감했습니다. 해당 사용자의 새로운 잔액: ${newBalance}원`);
}

async function handleAdminCheckBalanceText(message, targetUser) {
  const { guildId } = message;
  const userData = getUserData(guildId, targetUser.id);
  
  return message.reply(`${targetUser.tag}님의 현재 잔액: ${userData.balance}원`);
}

// 봇 로그인
client.login(TOKEN);
